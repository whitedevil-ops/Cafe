-- ============================================================================
-- 0135 — Two screen-access fixes: operator sessions, and two screens no role
--        could ever open.
--
-- BUG 1 (mine, from 0134) — an operator session lands on "Your role can't open
-- this section" for every screen.
-- my_screen_access() resolves the caller's role from cafe_members. An operator
-- has no row there by design, so it returned an EMPTY ARRAY (0096:71). The
-- dashboard layout guards with `?? ALL_SCREENS`, but an empty array is not
-- nullish, so the fallback never fired and the empty set blocked everything.
-- Confirmed by landing on the restricted screen after starting a real session.
--
-- BUG 2 (pre-existing, since 0096) — Reservations and Analytics were
-- unreachable by EVERY role, including the owner.
-- app-shell declares screenKey 'reservations' and 'analytics' for those nav
-- items, and blocks a screen whose key is absent from my_screen_access(). But
-- both keys are missing from default_role_screens() for every role AND from
-- all_screen_keys(), so:
--   * no role ever had them, owner included; and
--   * being absent from all_screen_keys() meant the owner's own Role-access UI
--     never rendered a toggle, so nobody could grant them either.
-- Both features are plan-gated and sold, which is what makes this worth fixing
-- now rather than filing: a café can be paying for Reservations on Growth and
-- still hit "your role can't open this section" as the owner. Found while
-- tracing bug 1 — the two share the same lookup, not the same cause.
-- ============================================================================

-- ── the canonical key list, now actually complete ───────────────────────────
-- Adding keys is additive: role_screen_overview() renders a toggle per key and
-- resolves each against default_role_screens(), so the two new ones simply
-- appear (off by default for the roles below that don't list them) instead of
-- being invisible. No existing grant changes.
create or replace function all_screen_keys()
returns text[] language sql immutable as $$
  select array['dashboard','pos','tables','bills','shift','kitchen','menu','customers','feedback',
               'inventory','purchases','recipes','coupons','loyalty','wallet','reports','expenses',
               'reservations','analytics',
               'profile','qr_codes','billing','settings']
$$;

-- ── defaults: owner and manager get both; everyone else unchanged ───────────
-- Deliberately conservative. The owner must have everything — that is the
-- whole contract of the role, and its list is marked "always full, never
-- overridable" in my_screen_access(). Manager already holds reports, so
-- analytics and reservations sit naturally alongside. Cashier, waiter, kitchen
-- and accountant are left exactly as they were: widening them here would
-- silently hand staff screens their owner never chose to give them, and now
-- that all_screen_keys() lists both, any owner who wants that can grant it
-- from Settings -> Staff -> Role access.
create or replace function default_role_screens(p_role member_role)
returns text[] language sql immutable as $$
  select case p_role
    when 'owner'      then array['dashboard','pos','tables','bills','shift','kitchen','menu','customers','feedback','inventory','purchases','recipes','coupons','loyalty','wallet','reports','expenses','reservations','analytics','profile','qr_codes','billing','settings']
    when 'manager'    then array['dashboard','pos','tables','bills','shift','kitchen','menu','customers','feedback','inventory','purchases','recipes','coupons','loyalty','wallet','reports','expenses','reservations','analytics','profile','qr_codes','settings']
    when 'cashier'    then array['dashboard','pos','tables','bills','shift','kitchen']
    when 'waiter'     then array['pos','tables','kitchen']
    when 'kitchen'    then array['kitchen']
    when 'accountant' then array['dashboard','bills','reports','expenses','billing']
    else array[]::text[]
  end
$$;

-- ── operator sessions see every screen ──────────────────────────────────────
-- An operator already has full row access through is_cafe_member() (0134), so
-- this grants nothing new at the database — it only stops the UI hiding what
-- the operator can already read. Screens still hide themselves on plan
-- entitlement, and every sensitive RPC keeps its own role check, so an
-- operator still cannot perform owner/manager-only actions: has_cafe_role() is
-- deliberately NOT widened.
--
-- coalesce() is required, not stylistic. `p_cafe_id = active_impersonated_cafe()`
-- is NULL when no session exists, and `if NULL then` does not take the branch —
-- which happens to be safe here because falling through denies. It is written
-- explicitly anyway so this pattern is never copied somewhere the fallthrough
-- grants instead (see 0134's note on the same trap in is_cafe_member).
create or replace function my_screen_access(p_cafe_id uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  v_role   member_role;
  v_result text[];
  v_ov     record;
begin
  select role into v_role from cafe_members where cafe_id = p_cafe_id and user_id = auth.uid() and status = 'active';

  if v_role is null then
    if coalesce(p_cafe_id = active_impersonated_cafe(), false) then
      return all_screen_keys();
    end if;
    return array[]::text[];
  end if;

  if v_role = 'owner' then return default_role_screens('owner'); end if; -- always full, never overridable

  v_result := default_role_screens(v_role);
  for v_ov in select screen_key, enabled from cafe_role_screens where cafe_id = p_cafe_id and role = v_role loop
    if v_ov.enabled then
      if not (v_ov.screen_key = any(v_result)) then v_result := array_append(v_result, v_ov.screen_key); end if;
    else
      v_result := array_remove(v_result, v_ov.screen_key);
    end if;
  end loop;
  return v_result;
end $$;
revoke execute on function my_screen_access(uuid) from public, anon;
grant execute on function my_screen_access(uuid) to authenticated;

-- Self-check: the owner must be able to reach every screen the nav can render,
-- which is exactly the bug above stated as an assertion.
do $$
begin
  if not ('reservations' = any(default_role_screens('owner')))
     or not ('analytics' = any(default_role_screens('owner'))) then
    raise exception 'owner must have every screen — reservations/analytics missing again';
  end if;
end $$;
