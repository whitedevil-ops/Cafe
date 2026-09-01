-- ============================================================================
-- 0199 — 0163's column-level UPDATE grant on cafes (built by grepping every
-- .from('cafes').update() call in the app as of 2026-08-28) missed the
-- onboarding wizard's own update (app/onboarding/onboarding-client.tsx),
-- which sets onboarding_meta and onboarding_step alongside dine_in/takeaway
-- in a single statement. Neither column was in the granted list, and
-- Postgres rejects the WHOLE statement — not just the ungranted columns —
-- when any one column in the SET list lacks a grant: "permission denied for
-- table cafes". A brand-new café could not get past the "How do you serve
-- customers?" onboarding step. Found live at a customer site.
-- ============================================================================

grant update (onboarding_step, onboarding_meta) on cafes to authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
declare v_grantable text[];
begin
  select array_agg(column_name::text) into v_grantable
    from information_schema.column_privileges
   where table_name = 'cafes' and grantee = 'authenticated' and privilege_type = 'UPDATE'
     and column_name in ('onboarding_step', 'onboarding_meta');
  if v_grantable is null or array_length(v_grantable, 1) < 2 then
    raise exception 'onboarding_step/onboarding_meta UPDATE grant missing: got %', v_grantable;
  end if;
end $$;
