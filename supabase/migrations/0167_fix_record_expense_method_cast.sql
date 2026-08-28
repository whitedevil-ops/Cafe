-- ============================================================================
-- record_expense has never actually worked in production: expenses.method is
-- a `payment_method` enum, but the function passed a plain `text` expression
-- (nullif(trim(coalesce(p_method, '')), '') — once a value has passed through
-- coalesce/trim/nullif its type is fixed as text, so Postgres no longer
-- applies the automatic literal-to-enum coercion it gives a bare string
-- constant) — every call has failed with "column method is of type
-- payment_method but expression is of type text" since this function shipped
-- in 0050. Confirmed live: 0 rows in `expenses` platform-wide.
--
-- Fix: the same nullif(...)::payment_method cast already used everywhere
-- else in this codebase for a nullable payment_method param (e.g. refunds'
-- v_method in 0028/0066/0098/0145). Found while verifying Phase 1's
-- entitlement fix to this same function (0166) — unrelated to that change,
-- pre-existing since 0050, re-bodied here byte-for-byte identical otherwise.
-- ============================================================================

create or replace function record_expense(
  p_cafe_id  uuid,
  p_category text,
  p_amount   integer,
  p_vendor   text default null,
  p_method   text default null,
  p_notes    text default null,
  p_spent_on date default current_date
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_cat text;
begin
  if not has_cafe_role(p_cafe_id, array['owner','manager']::member_role[]) then
    raise exception 'only an owner or manager can record expenses';
  end if;
  if not cafe_has_feature(p_cafe_id, 'expenses') then
    raise exception 'expenses are not available on this café''s plan';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be greater than zero';
  end if;
  v_cat := nullif(trim(coalesce(p_category, '')), '');
  if v_cat is null then raise exception 'category is required'; end if;

  insert into expenses (cafe_id, category, amount, vendor, method, notes, spent_on)
  values (p_cafe_id, v_cat, p_amount,
          nullif(trim(coalesce(p_vendor, '')), ''),
          nullif(trim(coalesce(p_method, '')), '')::payment_method,
          nullif(trim(coalesce(p_notes, '')), ''),
          coalesce(p_spent_on, current_date))
  returning id into v_id;

  insert into audit_logs (cafe_id, actor_id, action, entity, entity_id, meta)
  values (p_cafe_id, auth.uid(), 'expense.recorded', 'expenses', v_id,
          jsonb_build_object('amount', p_amount, 'category', v_cat));

  return (select to_jsonb(e) from expenses e where e.id = v_id);
end $$;
-- Grants unchanged.
