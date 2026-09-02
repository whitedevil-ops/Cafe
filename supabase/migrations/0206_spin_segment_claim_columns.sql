-- ============================================================================
-- 0206 — Add the three spin_segments columns that 0191 was supposed to add,
-- WITHOUT re-running the rest of 0191.
--
-- HOW THIS HAPPENED: a live-schema probe on 2026-09-02 found that migrations
-- 0191 and 0197 were never applied, while 0200-0205 were. The migration
-- history is not a clean tail — there are older gaps — so "run everything
-- after the last one you remember" is not a safe assumption here.
--
-- WHY THIS MATTERS RIGHT NOW: 0204 re-bodied spin_the_wheel and
-- save_spin_wheel by taking their definitions from 0191 and adding the new
-- 'spin' entitlement check. Those bodies reference spin_segments.max_claims
-- and .claims_used — columns 0191 never created. PL/pgSQL does not resolve
-- column references until execution, so both functions were created happily
-- and would only have failed the moment a real guest spun a wheel. Brewora's
-- wheel currently reports available = true, so this was live.
--
-- WHY NOT SIMPLY RUN 0191: because it would undo 0204. 0191 contains
-- `create or replace` for save_spin_wheel and spin_the_wheel, and its copies
-- still gate on 'loyalty'. Running it now would silently revert Spin & Win to
-- the old entitlement and reopen the guest-side hole 0204 closed — a fix
-- disappearing because an older migration was applied late is exactly the
-- class of failure this schema's self-checks exist to prevent.
--
-- So: only the columns. The function bodies already in the database are the
-- correct, newer ones and are deliberately left untouched.
-- ============================================================================

alter table spin_segments add column if not exists max_claims integer
  check (max_claims is null or max_claims > 0);
alter table spin_segments add column if not exists claims_used integer not null default 0
  check (claims_used >= 0);
-- Per-prize expiry override. Null falls back to the wheel's own expiry_days,
-- which is unchanged behaviour for every wheel that exists today.
alter table spin_segments add column if not exists expiry_days integer
  check (expiry_days is null or expiry_days > 0);

-- ── self-check ───────────────────────────────────────────────────────────
do $$
declare v_missing text[];
begin
  select array_agg(c)
    into v_missing
    from unnest(array['max_claims', 'claims_used', 'expiry_days']) c
   where not exists (
     select 1 from information_schema.columns
      where table_name = 'spin_segments' and column_name = c
   );
  if v_missing is not null then
    raise exception 'spin_segments is still missing %', v_missing;
  end if;

  -- The whole point of not running 0191 wholesale: 0204's entitlement check
  -- must still be in place afterwards. If this fails, spin_the_wheel has been
  -- reverted to an older body and the guest-side gate is gone.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'spin_the_wheel'
       and p.prosrc like '%cafe_feature_for_guest%'
  ) then
    raise exception 'spin_the_wheel no longer checks the spin entitlement — 0204 has been reverted';
  end if;
end $$;
