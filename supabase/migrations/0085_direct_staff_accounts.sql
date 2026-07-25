-- ============================================================================
-- 0085 — Replace the email-invite staff flow with direct account creation:
-- the owner/manager sets the new staff member's password themselves (via the
-- service-role admin API in app/api/staff/create) and this RPC does the
-- authorized DB write — no cafe_invites row, no pending state, no email ever
-- sent. Password resets work the same way (app/api/staff/reset-password),
-- calling admin.auth.admin.updateUserById directly — no magic-link email.
--
-- cafe_invites / create_staff_invite / claim_my_invites (0007, 0073) are left
-- in place rather than dropped: any already-pending invite still resolves
-- normally if that person eventually signs up with the matching email, and
-- nothing currently depends on removing them. The seat-cap math below still
-- counts pending invites alongside active members for the same reason
-- create_staff_invite did — the two mechanisms can coexist.
-- ============================================================================

create or replace function create_staff_member(p_cafe_id uuid, p_user_id uuid, p_role member_role)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_max_staff  integer;
  v_seat_count integer;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can add staff';
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

  insert into cafe_members (cafe_id, user_id, role, status)
  values (p_cafe_id, p_user_id, p_role, 'active')
  on conflict (cafe_id, user_id) do update set role = excluded.role, status = 'active';

  return jsonb_build_object('cafe_id', p_cafe_id, 'user_id', p_user_id, 'role', p_role::text);
end $$;

revoke execute on function create_staff_member(uuid, uuid, member_role) from public, anon;
grant execute on function create_staff_member(uuid, uuid, member_role) to authenticated;
