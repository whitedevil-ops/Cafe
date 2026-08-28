-- ============================================================================
-- Phase 1 security lockdown, part 1 — RLS/permission tightening. Every item
-- here closes a gap where a caller could bypass a permission check that
-- already exists somewhere else in the system (an RPC, a UI gate) by acting
-- on the table directly. None of this changes any legitimate behavior —
-- every column/action a real user/admin currently and correctly uses stays
-- exactly as it was.
-- ============================================================================

-- ── 1. cafes: column-level UPDATE grant, replacing the blanket table grant.
--
-- The "owner update" RLS policy (schema.sql / 0001_consolidated_baseline.sql)
-- has only a USING clause — no WITH CHECK, and Postgres/Supabase's default
-- table-wide UPDATE grant to `authenticated` means any café owner/manager can
-- PATCH ANY column on their own café row via a direct PostgREST call, not
-- just the fields the app's own UI happens to send. That includes plan,
-- status, verified, subscription_ends_at, billing_status — every control the
-- op_* RPCs below are supposed to be the only way to change.
--
-- Fix: column-level GRANT, the standard Postgres mechanism for "this role may
-- only touch these columns" (RLS's WITH CHECK can't express column-level
-- restriction — it only sees the resulting row, not which columns changed).
-- Same pattern this schema already uses for anon's `timezone` SELECT grant
-- (0086_fix_orders_page_anon_timezone.sql).
--
-- This exact list was built by grepping every real `.from('cafes').update()`
-- call in the app (2026-08-28) — every field a café owner/manager genuinely,
-- legitimately self-edits today. Confirmed by review before this migration
-- was written. Anything NOT in this list (plan, status, status_reason,
-- verified, verified_at, subscription_ends_at, trial_ends_at, billing_status,
-- every razorpay_* column, the expiry-reminder dedupe timestamps) becomes
-- writable only through the existing op_*/system_* RPCs (all SECURITY
-- DEFINER, so they're unaffected by this — they run as their owner, not the
-- caller).
revoke update on cafes from authenticated, anon;
grant update (
  name, description, logo_url, email, phone, website,
  gstin, gst_sac_code, gst_registered, legal_name, trade_name, state_code, invoice_prefix,
  tax_inclusive, tax_percent, service_charge,
  accept_cash, accept_upi_counter, accept_card_counter, accept_pay_counter, online_payments_enabled,
  address, city, state, pincode,
  dine_in, takeaway,
  bill_link_url, bill_link_enabled, bill_link_label,
  kot_printing_enabled, kot_print_on_update, cash_management_enabled, auto_deduct_stock,
  loyalty_enabled, loyalty_points_per_100, referral_enabled, referral_reward_amount
) on cafes to authenticated;

-- ── 2. Four tables whose RLS still allows ANY active admin (is_platform_admin())
--    to write directly, even though their own RPCs correctly require a
--    specific permission. An admin with, say, only cafes.view (no cafes.edit)
--    can't call op_set_feature_override — but could bypass that entirely by
--    PATCHing cafe_feature_overrides directly. No live exploit today (both
--    real admins are super_admin with every permission), but the gap is real
--    and becomes live the moment a narrower-role admin exists (Phase 4).
drop policy if exists "admin all" on platform_plans;
create policy "admin all" on platform_plans
  for all using (has_platform_permission('plans.change')) with check (has_platform_permission('plans.change'));

drop policy if exists "admin all" on cafe_feature_overrides;
create policy "admin all" on cafe_feature_overrides
  for all using (has_platform_permission('cafes.edit')) with check (has_platform_permission('cafes.edit'));
-- "member read" (café members reading their own overrides) is untouched.

drop policy if exists "admin all" on operator_notes;
create policy "admin all" on operator_notes
  for all using (has_platform_permission('cafes.edit')) with check (has_platform_permission('cafes.edit'));

drop policy if exists "admin read" on password_reset_log;
create policy "admin read" on password_reset_log for select using (has_platform_permission('audit.view'));
drop policy if exists "admin insert" on password_reset_log;
create policy "admin insert" on password_reset_log for insert with check (has_platform_permission('cafes.edit'));
-- Note: real inserts always go through op_log_password_reset/
-- op_log_admin_password_reset (SECURITY DEFINER, own checks), so this INSERT
-- policy only matters as a backstop against a direct table write.

-- ── 3. op_delete_cafe: the single most destructive admin action wrote only
--    to cafe_deletions, never platform_audit_logs — invisible on the actual
--    Audit Logs screen, which reads exclusively from platform_audit_logs.
--    Byte-for-byte identical to its 0102 body otherwise.
create or replace function op_delete_cafe(p_cafe_id uuid, p_confirm_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cafe     record;
  v_snapshot jsonb;
begin
  if not has_platform_permission('cafes.delete') then raise exception 'not authorized'; end if;

  select c.id, c.name, c.plan, p.email as owner_email
    into v_cafe
    from cafes c left join profiles p on p.id = c.owner_id
   where c.id = p_cafe_id;
  if v_cafe.id is null then raise exception 'café not found'; end if;

  if p_confirm_name is null or trim(p_confirm_name) <> v_cafe.name then
    raise exception 'the name you typed doesn''t match this café''s name exactly';
  end if;

  select jsonb_build_object(
    'staff_count', (select count(*) from cafe_members where cafe_id = p_cafe_id),
    'menu_items_count', (select count(*) from menu_items where cafe_id = p_cafe_id),
    'orders_count', (select count(*) from orders where cafe_id = p_cafe_id),
    'customers_count', (select count(*) from customers where cafe_id = p_cafe_id)
  ) into v_snapshot;

  insert into cafe_deletions (cafe_id, cafe_name, owner_email, plan, deleted_by, snapshot)
  values (v_cafe.id, v_cafe.name, v_cafe.owner_email, v_cafe.plan, auth.uid(), v_snapshot);

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value)
  values (auth.uid(), 'cafe.deleted', 'cafe', p_cafe_id,
          jsonb_build_object('name', v_cafe.name, 'plan', v_cafe.plan, 'owner_email', v_cafe.owner_email, 'snapshot', v_snapshot));

  delete from cafes where id = p_cafe_id;
end $$;

-- ── 4. op_update_lead_status: checked leads.view (read permission) instead
--    of leads.manage (the permission every other lead-mutating RPC in this
--    same file requires). Latent — both live admins are super_admin with
--    both — but wrong as written. Byte-for-byte identical to its 0117 body
--    otherwise.
create or replace function op_update_lead_status(p_lead_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_before text;
begin
  if not has_platform_permission('leads.manage') then raise exception 'not authorized'; end if;
  if p_status not in ('new', 'contacted', 'converted', 'dismissed') then raise exception 'invalid status'; end if;

  select status into v_before from leads where id = p_lead_id;
  if v_before is null then raise exception 'lead not found'; end if;

  update leads set status = p_status where id = p_lead_id;

  insert into platform_audit_logs (actor_id, action, target_type, target_id, previous_value, new_value)
  values (auth.uid(), 'lead.status_changed', 'lead', p_lead_id,
          jsonb_build_object('status', v_before), jsonb_build_object('status', p_status));
end $$;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
declare v_grantable text[];
begin
  select array_agg(column_name::text) into v_grantable
    from information_schema.column_privileges
   where table_name = 'cafes' and grantee = 'authenticated' and privilege_type = 'UPDATE';
  if v_grantable is null or array_length(v_grantable, 1) < 38 then
    raise exception 'cafes column-level UPDATE grant looks wrong: got %', v_grantable;
  end if;
  if 'plan' = any(v_grantable) or 'status' = any(v_grantable) or 'verified' = any(v_grantable) then
    raise exception 'cafes UPDATE grant still includes a protected column';
  end if;
end $$;
