-- ============================================================================
-- 0073 — Turn three of the nine declared plan features from decoration into
-- actual gates (audit finding: only "inventory" was ever checked anywhere).
-- Per the owner's explicit choice: advanced reports, staff seat caps, and
-- loyalty+coupons are the three to enforce now; the rest stay as-is.
--
-- Seat caps are numeric, not boolean, so they don't fit the existing
-- features jsonb (cafe_has_feature casts every value to boolean) — a
-- dedicated max_staff column is added instead, null meaning unlimited.
-- ============================================================================

alter table platform_plans add column if not exists max_staff integer;

-- Numbers reused from the owner's own example (Starter=3 / Growth=8 / Pro=
-- unlimited), mapped onto this project's actual tier names (there is no
-- separate "Growth" tier in platform_plans — "pro" is the one above
-- "starter"). Adjust freely; this is a business decision, not a technical one.
update platform_plans set max_staff = 1 where key = 'trial';
update platform_plans set max_staff = 3 where key = 'starter';
update platform_plans set max_staff = 8 where key = 'pro';
update platform_plans set max_staff = null where key = 'business';

-- loyalty/coupons weren't among the original nine declared feature keys —
-- adding them now, same starter=false / pro=true / business=true shape
-- advanced_reports already uses.
update platform_plans set features = features || '{"loyalty": false, "coupons": false}'::jsonb where key = 'trial';
update platform_plans set features = features || '{"loyalty": false, "coupons": false}'::jsonb where key = 'starter';
update platform_plans set features = features || '{"loyalty": true, "coupons": true}'::jsonb where key = 'pro';
update platform_plans set features = features || '{"loyalty": true, "coupons": true}'::jsonb where key = 'business';

-- ── Staff invites: was RLS-only (owner/manager, correctly), but had no seat
-- cap at all — an owner/manager could invite unlimited staff regardless of
-- plan. Direct insert stays available as a defense-in-depth backstop (RLS
-- already restricts it to owner/manager, matching every other admin-only
-- table in this project) but the app now goes through this RPC, which is
-- the only path that actually checks the cap.
create or replace function create_staff_invite(
  p_cafe_id uuid,
  p_email   text,
  p_role    member_role
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email      text;
  v_max_staff  integer;
  v_seat_count integer;
  v_id         uuid;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can invite staff';
  end if;

  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'enter a valid email address';
  end if;

  select pp.max_staff into v_max_staff
    from cafes c join platform_plans pp on pp.key = c.plan
   where c.id = p_cafe_id;

  if v_max_staff is not null then
    select
      (select count(*) from cafe_members where cafe_id = p_cafe_id and status = 'active')
      + (select count(*) from cafe_invites where cafe_id = p_cafe_id)
      into v_seat_count;
    if v_seat_count >= v_max_staff then
      raise exception 'your plan allows up to % staff seats (active members + pending invites) — remove one or upgrade your plan', v_max_staff;
    end if;
  end if;

  insert into cafe_invites (cafe_id, email, role)
  values (p_cafe_id, v_email, p_role)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'email', v_email, 'role', p_role::text);
end $$;

revoke execute on function create_staff_invite(uuid, text, member_role) from public, anon;
grant execute on function create_staff_invite(uuid, text, member_role) to authenticated;
