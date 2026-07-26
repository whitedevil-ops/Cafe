-- ============================================================================
-- 0093 — Cash top-ups for the customer wallet.
--
-- 0091 deliberately made top-ups online-only ("no cash top-up path, so every
-- credit is backed by a verified webhook, never a staff-entered amount with
-- no gateway proof"). That protected against a silent, unaccountable credit —
-- but a staff-collected cash top-up is exactly as auditable as any other cash
-- sale IF it's tied to the same shift/drawer reconciliation that already
-- catches a cash shortfall (0029): the cashier books the cash into the open
-- shift, and if it was never really collected, the drawer comes up short at
-- close_shift and an owner sees it immediately. So this reopens the cash path,
-- gated behind that same accountability mechanism rather than the
-- unaccountable-credit shape 0091 closed off.
--
-- Tier matching is automatic, not manual math: if the amount a staff member
-- types matches an active tier's pay_amount exactly, that tier's bonus
-- applies. An amount that doesn't match any tier is still accepted (an odd
-- top-up amount isn't an error) but credited 1:1 with no bonus.
--
-- `paid_amount` is added because `amount` on a topup row is the CREDITED
-- figure (pay + bonus) — the ledger effect — not what was physically
-- collected. Reports that need "real cash taken in" (not "value handed
-- out") need the paid figure separately, or a bonus-funded tier would
-- overstate cash collected. wallet_confirm_topup (0091) is recreated here
-- only to also populate it, so both top-up paths are comparable.
-- ============================================================================

alter table wallet_transactions add column if not exists source       text check (source in ('online', 'cash'));
alter table wallet_transactions add column if not exists paid_amount  integer;
update wallet_transactions set source = 'online' where kind = 'topup' and source is null;

-- ── Recreate to also stamp source + paid_amount (unchanged otherwise) ──────
create or replace function wallet_confirm_topup(p_attempt_id uuid, p_provider_payment_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_attempt payment_attempts%rowtype;
  v_tier    wallet_topup_tiers%rowtype;
begin
  select * into v_attempt from payment_attempts where id = p_attempt_id and purpose = 'wallet_topup';
  if v_attempt.id is null then raise exception 'top-up attempt not found'; end if;

  if v_attempt.status = 'confirmed' then return; end if;

  perform pg_advisory_xact_lock(hashtext('wallet:' || v_attempt.cafe_id::text || ':' || v_attempt.customer_id::text));

  select * into v_tier from wallet_topup_tiers where id = v_attempt.wallet_tier_id;
  if v_tier.id is null then raise exception 'top-up tier no longer exists'; end if;

  insert into wallet_transactions (cafe_id, customer_id, kind, amount, topup_tier_id, provider_payment_id, source, paid_amount, reason)
  values (v_attempt.cafe_id, v_attempt.customer_id, 'topup', v_tier.credit_amount, v_tier.id, p_provider_payment_id,
          'online', v_tier.pay_amount,
          'Top-up: paid ₹' || v_tier.pay_amount || ', credited ₹' || v_tier.credit_amount);

  update payment_attempts
     set status = 'confirmed', confirmed_at = now(), provider_payment_id = p_provider_payment_id
   where id = p_attempt_id;
end $$;
revoke execute on function wallet_confirm_topup(uuid, text) from public, anon;
grant execute on function wallet_confirm_topup(uuid, text) to authenticated;

-- ── Staff-collected cash top-up (POS/counter) ──────────────────────────────
create or replace function wallet_cash_topup(
  p_cafe_id uuid, p_customer_phone text, p_customer_name text, p_amount_paid integer
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_phone       text;
  v_customer_id uuid;
  v_tier        wallet_topup_tiers%rowtype;
  v_credit      integer;
  v_shift_id    uuid;
  v_balance     integer;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager','cashier']::member_role[]) then
    raise exception 'your role cannot take a wallet top-up';
  end if;
  if coalesce(p_amount_paid, 0) <= 0 then raise exception 'amount must be greater than zero'; end if;

  v_phone := nullif(regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g'), '');
  if v_phone is null or v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'a valid 10-digit phone number is required';
  end if;

  insert into customers (cafe_id, phone, name, last_seen)
  values (p_cafe_id, v_phone, nullif(trim(coalesce(p_customer_name, '')), ''), now())
  on conflict (cafe_id, phone) do update
    set last_seen = now(),
        name = coalesce(nullif(trim(coalesce(p_customer_name, '')), ''), customers.name)
  returning id into v_customer_id;

  perform pg_advisory_xact_lock(hashtext('wallet:' || p_cafe_id::text || ':' || v_customer_id::text));

  select * into v_tier from wallet_topup_tiers
    where cafe_id = p_cafe_id and active and pay_amount = p_amount_paid
    limit 1;
  v_credit := coalesce(v_tier.credit_amount, p_amount_paid);

  insert into wallet_transactions (cafe_id, customer_id, kind, amount, topup_tier_id, source, paid_amount, reason, created_by)
  values (p_cafe_id, v_customer_id, 'topup', v_credit, v_tier.id, 'cash', p_amount_paid,
          'Cash top-up: paid ₹' || p_amount_paid || ', credited ₹' || v_credit, auth.uid());

  -- Book the cash into the open shift's drawer, same as any other cash
  -- movement — record_cash_movement already re-checks the role and writes
  -- the audit_logs entry, so this just reuses it rather than duplicating
  -- that logic. No open shift (cash management off, or nobody opened one)
  -- just means there's nothing to reconcile against yet — the top-up still
  -- goes through, same tradeoff as any cash sale taken outside a shift.
  select id into v_shift_id from cash_shifts where cafe_id = p_cafe_id and status = 'open';
  if v_shift_id is not null then
    perform record_cash_movement(v_shift_id, 'add', p_amount_paid, 'Wallet top-up — ' || v_phone);
  end if;

  select coalesce(sum(amount), 0) into v_balance from wallet_transactions
    where cafe_id = p_cafe_id and customer_id = v_customer_id;

  return jsonb_build_object(
    'customer_id', v_customer_id, 'paid', p_amount_paid, 'credited', v_credit,
    'bonus', v_credit - p_amount_paid, 'matched_tier', v_tier.id is not null,
    'new_balance', v_balance, 'shift_recorded', v_shift_id is not null);
end $$;
revoke execute on function wallet_cash_topup(uuid, text, text, integer) from public, anon;
grant execute on function wallet_cash_topup(uuid, text, text, integer) to authenticated;

-- ── Extend the owner overview with real cash collected via top-ups ─────────
create or replace function wallet_overview(p_cafe_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_total          integer;
  v_cash_collected integer;
  v_wallets        jsonb;
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized for this café'; end if;

  select coalesce(sum(amount), 0) into v_total from wallet_transactions where cafe_id = p_cafe_id;

  select coalesce(sum(paid_amount), 0) into v_cash_collected
    from wallet_transactions where cafe_id = p_cafe_id and kind = 'topup' and source = 'cash';

  select coalesce(jsonb_agg(jsonb_build_object(
      'customer_id', customer_id, 'name', name, 'phone', phone, 'balance', balance
    ) order by balance desc), '[]'::jsonb)
    into v_wallets
    from (
      select c.id as customer_id, c.name, c.phone, sum(wt.amount) as balance
      from wallet_transactions wt join customers c on c.id = wt.customer_id
      where wt.cafe_id = p_cafe_id
      group by c.id, c.name, c.phone
      having sum(wt.amount) <> 0
      order by sum(wt.amount) desc
      limit 200
    ) s;

  return jsonb_build_object('total_outstanding', v_total, 'cash_collected_total', v_cash_collected, 'wallets', v_wallets);
end $$;
revoke execute on function wallet_overview(uuid) from public, anon;
grant execute on function wallet_overview(uuid) to authenticated;
