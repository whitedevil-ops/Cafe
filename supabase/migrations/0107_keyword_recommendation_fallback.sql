-- ============================================================================
-- 0107 — Keyword-based item cross-sell fallback.
--
-- get_recommendations (0055) already ranks: owner-pinned rule > owner rule >
-- sales pairing > owner-approved category rule > popularity. The gap: a café
-- with none of the first four populated (no pairings set, no category rules
-- approved, no order history with >=2 co-occurrences yet) fell straight to
-- raw popularity — the SAME single "most popular item" regardless of what
-- was actually in the cart. A pizza order and a plain-coffee order both got
-- offered whatever the café's overall best-seller happened to be (reported:
-- always "warm brownie", no matter the cart).
--
-- This inserts a new tier between category rules and popularity: the exact
-- same deterministic keyword vocabulary lib/recommend.ts already uses for
-- its setup-time category-pairing suggester, applied directly to items at
-- order time instead. Works from the very first order with zero owner
-- setup. Kept manually in sync with lib/recommend.ts's word lists — one
-- runs in SQL at order time, the other in JS at menu-setup time, so they
-- can't share code, but a future edit to either vocabulary should check
-- both.
--
-- Validated against real restaurant upsell research (not guessed): a drink
-- or side alongside a main is the standard, highest-converting prompt
-- (garlic bread / dip / a drink against a pizza or burger order); dessert
-- specifically pairs with a hot beverage, timed for after the mains — never
-- another main dish, which is a competing order, not a complementary one.
--
-- New priority: pinned rule(6) > rule(5) > sales pairing(4) > category
-- rule(3) > THIS keyword fallback(2) > popularity(1, last resort only).
-- ============================================================================

create or replace function get_recommendations(p_cafe_id uuid, p_item_ids uuid[], p_limit integer default 4)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_enabled       boolean;
  v_status        text;
  v_result        jsonb;
  v_ids           uuid[];
  main_words      text[] := array['pizza','burger','pasta','biryani','momo','dosa','thali','roll','sandwich','noodle','rice','wrap','burrito','taco','sub','panini','kebab','kabab','tikka','curry','maggi','paratha','uttapam','idli','poha','chowmein','hakka','manchurian','meal','combo','platter','bowl','frankie','shawarma','pav','vada','khichdi'];
  side_words      text[] := array['side','fries','bread','dip','sauce','chutney','raita','papad','salad','nachos','wings','starter','appetizer','garlic bread','potato','crispy'];
  drink_words     text[] := array['drink','beverage','coffee','tea','juice','shake','soda','cola','lassi','mojito','lemonade','smoothie','cooler','mocktail','buttermilk','chaas','cappuccino','latte','espresso','americano','frappe','sharbat','nimbu','thandai','cold coffee'];
  hot_drink_words text[] := array['coffee','tea','latte','cappuccino','espresso','americano','chai'];
  dessert_words   text[] := array['dessert','sweet','cookie','brownie','cake','ice cream','kulfi','gulab jamun','rasmalai','halwa','kheer','pastry','waffle','donut','mousse','pudding','tiramisu'];
begin
  v_ids := coalesce(p_item_ids, array[]::uuid[]);
  select recommendations_enabled, status into v_enabled, v_status from cafes where id = p_cafe_id;
  if not coalesce(v_enabled, false) or coalesce(v_status, 'active') <> 'active' then
    return '[]'::jsonb;
  end if;

  with cart as (select unnest(v_ids) as item_id),
  cart_items as (
    select mi.id, lower(mi.name) as name, mi.category_id
      from menu_items mi join cart c on c.item_id = mi.id
  ),
  cart_flags as (
    select
      bool_or(exists (select 1 from unnest(main_words) w where name ilike '%' || w || '%'))      as has_main,
      bool_or(exists (select 1 from unnest(side_words) w where name ilike '%' || w || '%'))       as has_side,
      bool_or(exists (select 1 from unnest(hot_drink_words) w where name ilike '%' || w || '%'))  as has_hot_drink
    from cart_items
  ),
  cart_cats as (
    select distinct category_id from cart_items where category_id is not null
  ),
  candidates as (
    select p.suggested_item_id as id, 6 as tier, 'Chef''s pick' as reason
      from menu_pairings p join cart c on c.item_id = p.item_id
     where p.cafe_id = p_cafe_id and p.pinned
    union all
    select p.suggested_item_id, 5, 'Goes well together'
      from menu_pairings p join cart c on c.item_id = p.item_id
     where p.cafe_id = p_cafe_id and not p.pinned
    union all
    select s.paired_item_id, 4, 'Often ordered together'
      from order_pair_stats s join cart c on c.item_id = s.item_id
     where s.cafe_id = p_cafe_id and s.times > 0
    union all
    select mi.id, 3, 'Great with this'
      from category_pairings cp
      join cart_cats cc on cc.category_id = cp.category_id
      join menu_items mi on mi.category_id = cp.suggested_category_id and mi.cafe_id = p_cafe_id
     where cp.cafe_id = p_cafe_id
    union all
    -- Keyword fallback — zero owner setup, zero order history required.
    -- A main in the cart → suggest sides/drinks/desserts (never another
    -- main: that's a competing order). A side alone → suggest a drink. A
    -- hot drink → suggest dessert. Ranked below category rules (owner-
    -- approved) but above raw popularity (context-blind).
    select mi.id, 2,
           case
             when exists (select 1 from unnest(drink_words) w where lower(mi.name) ilike '%' || w || '%') then 'Beverage pairing'
             when exists (select 1 from unnest(side_words) w where lower(mi.name) ilike '%' || w || '%') then 'Complementary side'
             else 'Goes great after'
           end
      from menu_items mi, cart_flags cf
     where mi.cafe_id = p_cafe_id
       and (
             (cf.has_main and (
               exists (select 1 from unnest(drink_words) w where lower(mi.name) ilike '%' || w || '%')
               or exists (select 1 from unnest(side_words) w where lower(mi.name) ilike '%' || w || '%')
               or exists (select 1 from unnest(dessert_words) w where lower(mi.name) ilike '%' || w || '%')
             ))
          or (cf.has_side and not cf.has_main and exists (select 1 from unnest(drink_words) w where lower(mi.name) ilike '%' || w || '%'))
          or (cf.has_hot_drink and exists (select 1 from unnest(dessert_words) w where lower(mi.name) ilike '%' || w || '%'))
       )
    union all
    select pop.menu_item_id, 1, 'Popular here'
      from public_popular_items(p_cafe_id, 8) pop
  ),
  filtered as (
    select cand.id, max(cand.tier) as tier,
           (array_agg(cand.reason order by cand.tier desc))[1] as reason
      from candidates cand
      join menu_items mi on mi.id = cand.id
     where mi.cafe_id = p_cafe_id
       and mi.available = true and mi.archived = false
       and not (cand.id = any(v_ids))     -- never re-suggest something already in the cart
     group by cand.id
  ),
  ranked as (
    select f.id, mi.name, mi.price, f.reason,
           row_number() over (
             order by f.tier desc,
                      greatest(0, mi.price - coalesce(mi.cost, 0)) desc,  -- contribution tiebreak
                      mi.price asc
           ) as rn
      from filtered f join menu_items mi on mi.id = f.id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price, 'reason', reason) order by rn), '[]'::jsonb)
    into v_result
    from ranked
   where rn <= greatest(1, least(coalesce(p_limit, 4), 6));

  return v_result;
end $$;
