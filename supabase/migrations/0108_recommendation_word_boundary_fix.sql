-- ============================================================================
-- 0108 — Fix substring-collision bug in 0107's keyword fallback.
--
-- 0107 matched keywords with naive `ILIKE '%word%'`. That let 'cola' (kept
-- in drink_words to catch "Coca Cola") match inside "ch[ocola]te" — so any
-- item with "chocolate" in its name (Chocolate Lava Cake, Chocolate
-- Brownie, ...) got mislabeled with a beverage reason instead of a dessert
-- one. Caught during live verification against Brewora's real menu, not
-- user-reported.
--
-- Same class of bug could also cause a wrong *selection*, not just a wrong
-- label — e.g. a "Chocolate Sauce" side item would match drink_words via
-- the same 'cola' collision and get offered as a drink-tier candidate.
--
-- Fix: a small immutable helper, contains_word(), that requires a
-- non-letter (or start/end of string) on both sides of the match — so
-- "cola" matches "Coca Cola" but not the "cola" hiding inside "chocolate".
-- Replaces every ILIKE word-list check in get_recommendations's keyword
-- tier (cart_flags + the tier-2 candidate branch). Also reorders the
-- reason label to check dessert_words first, ahead of drink_words, so a
-- dessert match wins its own label rather than falling through.
--
-- No other tier (pinned/rule/sales/category/popularity) is touched.
-- ============================================================================

create or replace function contains_word(p_text text, p_words text[])
returns boolean
language sql
immutable
as $$
  select exists (
    select 1 from unnest(p_words) w
    where lower(p_text) ~ ('(^|[^a-z])' || lower(w) || '($|[^a-z])')
  )
$$;

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
    select mi.id, mi.name, mi.category_id
      from menu_items mi join cart c on c.item_id = mi.id
  ),
  cart_flags as (
    select
      bool_or(contains_word(name, main_words))      as has_main,
      bool_or(contains_word(name, side_words))       as has_side,
      bool_or(contains_word(name, hot_drink_words))  as has_hot_drink
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
             when contains_word(mi.name, dessert_words) then 'Sweet finish'
             when contains_word(mi.name, drink_words) then 'Beverage pairing'
             when contains_word(mi.name, side_words) then 'Complementary side'
             else 'Goes great after'
           end
      from menu_items mi, cart_flags cf
     where mi.cafe_id = p_cafe_id
       and (
             (cf.has_main and (
               contains_word(mi.name, drink_words)
               or contains_word(mi.name, side_words)
               or contains_word(mi.name, dessert_words)
             ))
          or (cf.has_side and not cf.has_main and contains_word(mi.name, drink_words))
          or (cf.has_hot_drink and contains_word(mi.name, dessert_words))
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
