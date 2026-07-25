-- ============================================================================
-- 0080 — Let staff label a customer who has no name on file yet.
--
-- QR self-order only ever collects a phone number (by design — "no login to
-- force"), so a customer who always orders that way shows up as "Unnamed
-- customer" forever even after 30+ visits, with no way for the café to fix
-- that once they actually learn who it is. customers is member-read/no-write
-- (0071 P0 hardening) like everything else, so this is a normal SECURITY
-- DEFINER RPC, not a new grant on the table.
-- ============================================================================

create or replace function update_customer_name(p_customer_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id uuid;
  v_before  text;
  v_after   text;
begin
  select cafe_id, name into v_cafe_id, v_before from customers where id = p_customer_id;
  if v_cafe_id is null then raise exception 'customer not found'; end if;
  if not is_cafe_member(v_cafe_id) then raise exception 'not authorized'; end if;

  v_after := nullif(trim(p_name), '');
  update customers set name = v_after where id = p_customer_id;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (v_cafe_id, auth.uid(), 'customer.name_updated', 'customers', p_customer_id,
          jsonb_build_object('previous_name', v_before, 'name', v_after));
end $$;

revoke execute on function update_customer_name(uuid, text) from public, anon;
grant execute on function update_customer_name(uuid, text) to authenticated;
