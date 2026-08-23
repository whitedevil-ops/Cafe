-- ============================================================================
-- 0155 — Surface Today's Offer items (0154) as a checkout suggestion, and
-- make get_recommendations' returned price offer-aware.
--
-- New tier 7 outranks even pinned "Chef's pick" pairings (tier 6) — an
-- active discount is the single most time-sensitive, most worth-surfacing
-- signal at checkout. Café-wide, not paired against the current cart (same
-- as the existing tier-1 popularity fallback already is) — the client
-- already short-circuits to an empty list when the cart is empty, so this
-- only ever appears once there's something to check out.
--
-- The returned `price` also becomes offer-aware, not just cosmetic:
-- pos-client.tsx builds the cart line directly from a recommendation's
-- `price` when it's added, so if this RPC kept returning the base price, an
-- added suggestion would silently charge the wrong amount until a full
-- page refresh reconciled it against place_order/staff_place_order's own
-- (already correct, per 0154) server-side price.
--
-- Signature unchanged (p_cafe_id uuid, p_item_ids uuid[], p_limit integer
-- default 4) — no drop needed, grant from 0055 stands as-is.
-- ============================================================================

create or replace function get_recommendations(p_cafe_id uuid, p_item_ids uuid[], p_limit integer default 4)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_enabled       boolean;
  v_status        text;
  v_result        jsonb;
  v_ids           uuid[];
  v_weekday       smallint;
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

  v_weekday := cafe_current_weekday(p_cafe_id);   -- NEW (0155)

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
    -- NEW (0155): active-today offer items, café-wide — the single most
    -- time-sensitive signal, ranked above even pinned pairings.
    select mi.id as id, 7 as tier, 'Today''s Offer' as reason
      from menu_items mi
     where mi.cafe_id = p_cafe_id
       and mi.offer_price is not null and mi.offer_days is not null
       and v_weekday = any(mi.offer_days)
    union all
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
    select f.id, mi.name,
           -- NEW (0155): today's discounted price when this item's own offer
           -- is active — matches place_order/staff_place_order's resolution
           -- exactly, so a recommendation added to a cart charges the same
           -- amount the server will.
           case
             when mi.offer_price is not null and mi.offer_days is not null and v_weekday = any(mi.offer_days)
               then mi.offer_price
             else mi.price
           end as price,
           f.reason,
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

do $$
declare v_count integer;
begin
  select count(*) into v_count from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_recommendations';
  if v_count <> 1 then
    raise exception 'expected exactly one get_recommendations after this migration, found % -- an orphaned overload is present', v_count;
  end if;
end $$;
