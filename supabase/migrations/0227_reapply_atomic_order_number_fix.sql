-- ============================================================================
-- 0227 — 0203's duplicate-bill-number fix was silently reverted for
-- place_order (QR guest ordering) by migration 0214.
--
-- FOUND during a full-product audit (2026-09-09), not reported live this
-- time — but it is the exact same bug 0203 fixed on 02 Sept 2026 (two
-- different orders handed the same bill number), now live again for every
-- QR order since 0214 shipped.
--
-- CAUSE: 0214 restated place_order's entire ~250-line body via a literal
-- `create or replace function place_order(...)`, evidently copied forward
-- from a stale pre-0203 source rather than the live, already-patched
-- definition — precisely the failure mode 0203's own comment warned about:
-- "copying several hundred lines forward to change one of them is exactly
-- how an unrelated fix gets silently reverted." staff_place_order was NOT
-- re-broken the same way — nothing has done a literal CREATE OR REPLACE of
-- it since 0203's live patch, so it still correctly calls
-- next_order_short_code(). Only place_order regressed.
--
-- FIX: reapply 0203's own live regex-patch technique, scoped to just
-- place_order this time (staff_place_order already calls the counter and
-- the pattern below would correctly find zero matches there — the loop is
-- singular on purpose, not because the technique doesn't generalize).
-- Restating the function body again here was deliberately avoided for the
-- same reason 0203 avoided it the first time.
-- ============================================================================

do $$
declare
  v_src     text;
  v_new     text;
  v_pattern text := 'select\s+count\(\*\)\s*\+\s*1\s+into\s+v_seq\s+from\s+orders\s*' ||
                    'where\s+cafe_id\s*=\s*([pv]_cafe_id)\s+and\s+status\s*<>\s*''cancelled''\s+' ||
                    'and\s+created_at\s*>=\s*v_day_start\s*;';
  v_hits    int;
begin
  select count(*) into v_hits
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_hits <> 1 then
    raise exception 'expected exactly one place_order, found % — refusing to rewrite an ambiguous overload', v_hits;
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';

  if v_src is null then
    raise exception 'place_order does not exist — cannot repoint it at the counter';
  end if;

  select count(*) into v_hits from regexp_matches(v_src, v_pattern, 'gi');
  if v_hits <> 1 then
    raise exception 'expected exactly one short_code count in place_order, found % — refusing to guess', v_hits;
  end if;

  v_new := regexp_replace(v_src, v_pattern, 'v_seq := next_order_short_code(\1);', 'gi');
  execute v_new;
  raise notice 'repointed place_order at next_order_short_code() again';
end $$;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';

  if v_src !~ 'next_order_short_code' then
    raise exception 'place_order is still not using the counter';
  end if;
  if v_src ~* 'count\(\*\)\s*\+\s*1\s+into\s+v_seq' then
    raise exception 'place_order still contains the old counting logic';
  end if;

  -- staff_place_order was never re-broken (confirmed: no literal CREATE OR
  -- REPLACE of it since 0203) — assert that stays true so this migration
  -- would fail loudly rather than silently if that ever changes too.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'staff_place_order';
  if v_src !~ 'next_order_short_code' then
    raise exception 'staff_place_order is unexpectedly not using the counter either — investigate before assuming this migration alone is sufficient';
  end if;
end $$;
