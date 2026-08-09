-- 0127 — Fix `function gen_random_bytes(integer) does not exist` in
-- spin_the_wheel (0125). Nobody could spin: every guest spin raised.
--
-- ROOT CAUSE: exactly the one 0024 already documented and fixed for 0023.
-- Supabase installs pgcrypto into the `extensions` schema, and 0125 pinned
-- `set search_path = public`, which excludes it. The function creates fine —
-- search_path is only resolved when the body runs — so check-schema.sql
-- happily reported it present, and the RPC probe I ran against it only ever
-- reached the "order not found" guard above this line. It took actually
-- winning a prize to hit it.
--
-- THE FIX is 0024's: `set search_path = public, extensions`. Still explicit
-- and fixed, which is what keeps SECURITY DEFINER safe — just one that
-- includes where pgcrypto actually lives.
--
-- Also replaces the code generator. The old expression leaned on base64 and a
-- translate() whose from/to lists were different lengths, which silently
-- DELETES the unmatched characters — so a code could come out shorter than
-- five characters. Drawing from an explicit alphabet says what it means, and
-- guarantees the length. The alphabet omits O/0 and I/1, which is the whole
-- point at a noisy counter.

create or replace function spin_the_wheel(p_receipt_token uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_order    orders%rowtype;
  v_wheel    spin_wheels%rowtype;
  v_total    integer;
  v_roll     integer;
  v_seg      spin_segments%rowtype;
  v_code     text;
  v_result   spin_results%rowtype;
  v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_i        integer;
  v_try      integer;
begin
  select * into v_order from orders where receipt_token = p_receipt_token;
  if not found then raise exception 'order not found'; end if;

  -- Serialise per order, so a double tap can't produce two draws before the
  -- unique index is reached.
  perform pg_advisory_xact_lock(hashtext('spin:' || v_order.id::text));

  if exists (select 1 from spin_results where order_id = v_order.id) then
    raise exception 'this order has already had its spin';
  end if;
  if v_order.payment_status <> 'paid' then
    raise exception 'the spin unlocks once the order is paid';
  end if;

  select * into v_wheel from spin_wheels where cafe_id = v_order.cafe_id and active;
  if not found then raise exception 'this café is not running a spin wheel'; end if;

  select coalesce(sum(weight), 0) into v_total from spin_segments where wheel_id = v_wheel.id;
  if v_total <= 0 then raise exception 'this wheel has no slices to land on'; end if;

  -- Weighted draw: roll once into the total, then take the first slice whose
  -- running total passes it.
  v_roll := floor(random() * v_total)::integer;
  select s.* into v_seg from (
    select seg.*, sum(seg.weight) over (order by seg.sort, seg.id) as cum
    from spin_segments seg where seg.wheel_id = v_wheel.id
  ) s where s.cum > v_roll order by s.cum limit 1;
  if not found then raise exception 'the wheel could not settle on a slice'; end if;

  -- Short, unambiguous at a noisy counter: no O/0 or I/1. 32^5 per café is
  -- far more room than a wheel ever needs, but codes are unique per café, so
  -- retry a few times rather than failing a guest's spin on a coin-flip
  -- collision. The unique index remains the real guarantee.
  for v_try in 1..8 loop
    v_code := 'W';
    for v_i in 1..5 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1);
    end loop;
    exit when not exists (
      select 1 from spin_results where cafe_id = v_order.cafe_id and code = v_code
    );
  end loop;

  insert into spin_results (
    cafe_id, segment_id, order_id, customer_id,
    label, kind, menu_item_id, variant_id, value, code, expires_at
  ) values (
    v_order.cafe_id, v_seg.id, v_order.id, v_order.customer_id,
    v_seg.label, v_seg.kind, v_seg.menu_item_id, v_seg.variant_id, v_seg.value, v_code,
    case when v_wheel.expiry_days is null then null else now() + (v_wheel.expiry_days || ' days')::interval end
  ) returning * into v_result;

  return jsonb_build_object(
    'segment_id', v_result.segment_id, 'label', v_result.label, 'kind', v_result.kind,
    'value', v_result.value, 'code', v_result.code, 'expires_at', v_result.expires_at
  );
end $$;

revoke execute on function spin_the_wheel(uuid) from public;
grant execute on function spin_the_wheel(uuid) to anon, authenticated;
