-- ============================================================================
-- 0203 — Two different orders could be given the same bill number.
--
-- REPORTED LIVE (FEAR & FEAST, 02 Sept 2026):
--   11:41  #3  M1   ₹105  cancelled
--   11:46  #3  T14  ₹230  completed   <- #3 handed out a second time
--   11:47  #4  T14  ₹310  completed
--   11:50  #4  L1   ₹45   completed   <- #4 handed out a second time
--
-- Three duplicate numbers existed across two days, and one of them (#4) was
-- shared by two genuinely completed, paid orders. A bill number that
-- identifies two different sales is an accounting problem, not a display one.
--
-- CAUSE — one line, in both place_order (QR) and staff_place_order (POS):
--
--   select count(*) + 1 into v_seq from orders
--     where cafe_id = v_cafe_id and status <> 'cancelled' and created_at >= v_day_start;
--
-- The number was never stored, only recounted from scratch each time, and
-- cancelled orders were excluded from the count. So:
--
--   1. REUSE. Cancel an order and it leaves the count — the next order is
--      handed the number that just freed up. That is the #3 case above.
--   2. RACE. count(*)+1 takes no lock. Two orders placed in the same moment
--      both read the same count and both get the same number. That is the #4
--      case: two completed orders, no cancellation involved.
--
-- FIX: store the last number issued per café per business day and increment
-- it atomically. A number, once issued, is never handed out again — whatever
-- happens to the order afterwards. This is the same shape as
-- gst_invoice_counters (0031), which was deliberately built this way for
-- exactly this reason; short_code simply never got the same treatment.
-- ============================================================================

create table if not exists order_number_counters (
  cafe_id      uuid not null references cafes(id) on delete cascade,
  business_day date not null,
  last_number  integer not null default 0,
  primary key (cafe_id, business_day)
);

alter table order_number_counters enable row level security;
-- No policies on purpose. Only the SECURITY DEFINER function below touches
-- this, exactly as gst_invoice_counters is handled: staff have no reason to
-- read or write a counter directly, and being able to would mean being able
-- to reissue a bill number.

/**
 * The next order number for a café, for its own business day.
 *
 * Atomic by construction: the INSERT ... ON CONFLICT DO UPDATE takes a row
 * lock on the counter, so two orders placed in the same instant queue behind
 * each other and receive different numbers rather than both counting to the
 * same total.
 *
 * Seeded from whatever numbers today already carries, so applying this
 * mid-service cannot reissue a number already printed on a ticket. Only
 * numeric short_codes are considered — a café whose codes were ever something
 * else simply starts from the numeric high-water mark, which is still
 * forward-only.
 *
 * The daily reset is kept deliberately: staff and kitchen tickets rely on
 * short, human-sized numbers, and cafe_day_start() already defines when a
 * café's day turns over (including a business day that runs past midnight).
 */
create or replace function next_order_short_code(p_cafe_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_day_start timestamptz;
  v_day       date;
  v_seed      integer;
  v_next      integer;
begin
  v_day_start := cafe_day_start(p_cafe_id);
  v_day := v_day_start::date;

  -- Only on the first order of a café's day: adopt the highest number
  -- already used today so an in-flight service never sees a number repeat.
  if not exists (select 1 from order_number_counters c
                  where c.cafe_id = p_cafe_id and c.business_day = v_day) then
    select coalesce(max(o.short_code::integer), 0) into v_seed
      from orders o
     where o.cafe_id = p_cafe_id
       and o.created_at >= v_day_start
       and o.short_code ~ '^[0-9]+$';
    insert into order_number_counters (cafe_id, business_day, last_number)
      values (p_cafe_id, v_day, coalesce(v_seed, 0))
      on conflict (cafe_id, business_day) do nothing;
  end if;

  insert into order_number_counters as c (cafe_id, business_day, last_number)
       values (p_cafe_id, v_day, 1)
  on conflict (cafe_id, business_day)
    do update set last_number = c.last_number + 1
    returning c.last_number into v_next;

  return v_next;
end $$;

revoke execute on function next_order_short_code(uuid) from public, anon;
-- The order-placement functions are SECURITY DEFINER and call this as their
-- own owner, so no caller needs execute directly — including anon, which
-- places QR orders through place_order.

-- ── Point both order-placement functions at the counter ────────────────────
--
-- Rewritten from the LIVE definition via pg_get_functiondef rather than by
-- restating the function bodies here. place_order and staff_place_order are
-- the two largest and most safety-critical functions in this schema (combos,
-- coupons, loyalty, spin prizes, GST, offers, idempotency), they have been
-- re-bodied by a dozen migrations, and copying several hundred lines forward
-- to change one of them is exactly how an unrelated fix gets silently
-- reverted. This changes the one statement and leaves every other byte of
-- whatever is actually deployed untouched.
--
-- The regex tolerates whitespace and line breaks because pg_get_functiondef
-- reformats. If it matches nothing the DO block raises rather than proceeding
-- quietly — a silent no-op here would leave duplicate bill numbers in place
-- while reporting success, which is the same class of failure that made this
-- bug expensive to find in the first place.
do $$
declare
  v_fn      text;
  v_src     text;
  v_new     text;
  -- The café id is CAPTURED rather than hardcoded, because the two functions
  -- spell it differently: place_order filters on the local v_cafe_id, while
  -- staff_place_order filters on its p_cafe_id parameter. Substituting a
  -- fixed name would have produced a function referencing a variable that
  -- does not exist in it.
  v_pattern text := 'select\s+count\(\*\)\s*\+\s*1\s+into\s+v_seq\s+from\s+orders\s*' ||
                    'where\s+cafe_id\s*=\s*([pv]_cafe_id)\s+and\s+status\s*<>\s*''cancelled''\s+' ||
                    'and\s+created_at\s*>=\s*v_day_start\s*;';
  v_hits    int;
begin
  foreach v_fn in array array['place_order', 'staff_place_order'] loop
    -- Overload guard. Selecting a definition by name alone would silently
    -- pick one of several and rewrite only that, leaving the other still
    -- issuing duplicate numbers — and this schema has had orphaned overloads
    -- before (see 0201's own self-check).
    select count(*) into v_hits
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_hits <> 1 then
      raise exception 'expected exactly one % , found % — refusing to rewrite an ambiguous overload', v_fn, v_hits;
    end if;

    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;

    if v_src is null then
      raise exception '% does not exist — cannot repoint it at the counter', v_fn;
    end if;

    select count(*) into v_hits
      from regexp_matches(v_src, v_pattern, 'gi') ;
    if v_hits <> 1 then
      raise exception 'expected exactly one short_code count in %, found % — refusing to guess', v_fn, v_hits;
    end if;

    v_new := regexp_replace(v_src, v_pattern, 'v_seq := next_order_short_code(\1);', 'gi');
    execute v_new;
    raise notice 'repointed % at next_order_short_code()', v_fn;
  end loop;
end $$;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
declare v_src text; v_fn text;
begin
  foreach v_fn in array array['place_order', 'staff_place_order'] loop
    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;

    if v_src !~ 'next_order_short_code' then
      raise exception '% is still not using the counter', v_fn;
    end if;
    if v_src ~* 'count\(\*\)\s*\+\s*1\s+into\s+v_seq' then
      raise exception '% still contains the old counting logic', v_fn;
    end if;
  end loop;

  if not exists (select 1 from pg_tables where tablename = 'order_number_counters') then
    raise exception 'order_number_counters was not created';
  end if;
end $$;
