-- ============================================================================
-- BREWORA CAFÉ — complete demo tenant. IDEMPOTENT: safe to re-run (wipes and
-- recreates ONLY the demo café; every row hangs off the fixed demo cafe_id and
-- cascades on delete, so no other café is ever touched).
--
-- REQUIRES: migrations 0001–0012 applied first (0012 adds table_sessions,
-- notifications, request_bill/call_waiter/move_session/close_session — the
-- seed's active-orders block creates real sessions and will fail loudly,
-- not silently, if 0012 is missing; run supabase/check-schema.sql to confirm).
-- Compatible through 0030 — tax/service_charge are computed via the real
-- compute_bill() function (not reimplemented here) so seeded orders match
-- exactly what place_order/staff_place_order would have produced.
-- EDIT ONE LINE: the owner email below must be YOUR login email.
--
-- Honest notes on what this seed does NOT fake (schema doesn't support it yet,
-- or supports it but there's nothing meaningful to pre-populate):
-- kitchen stations, table areas, opening-hours records, failed-payment states,
-- verification records, coupon entry at checkout (coupons seed but are dormant),
-- refunds, KOT printer/station config, and cash-shift history (cash management
-- is left ON for this café — see cafes.cash_management_enabled below — but no
-- shift is pre-opened; the pilot should open a real one). The order_source
-- enum's 'staff' value is unused by the app (only 'qr' and 'pos' are ever
-- written) and is left alone here rather than seeded.
-- ============================================================================

do $$
declare
  v_owner_email text := 'v.sharma78767876@gmail.com';  -- << EDIT if different
  v_cafe  uuid := 'c0ffee00-0000-4000-a000-000000000001';
  v_owner uuid;

  -- staff (fixed ids so re-runs are clean)
  v_staff jsonb := '[
    {"id":"c0ffee00-0000-4000-a000-00000000a002","name":"Priya Sharma","email":"priya.demo@brewora.example","role":"manager"},
    {"id":"c0ffee00-0000-4000-a000-00000000a003","name":"Rohit Kumar","email":"rohit.demo@brewora.example","role":"cashier"},
    {"id":"c0ffee00-0000-4000-a000-00000000a004","name":"Amit Verma","email":"amit.demo@brewora.example","role":"kitchen"},
    {"id":"c0ffee00-0000-4000-a000-00000000a005","name":"Neha Singh","email":"neha.demo@brewora.example","role":"kitchen"},
    {"id":"c0ffee00-0000-4000-a000-00000000a006","name":"Karan Yadav","email":"karan.demo@brewora.example","role":"waiter"}
  ]'::jsonb;
  v_s jsonb;

  -- category ids
  c_bur uuid; c_piz uuid; c_cof uuid; c_drk uuid; c_fri uuid; c_san uuid; c_des uuid;

  -- order-generation working vars
  v_ts timestamptz; v_seq int; v_order uuid; v_cust uuid; v_table uuid;
  v_type order_type; v_status order_status; v_sub int; v_disc int; v_code text;
  v_item record; v_var record; v_qty int; v_unit int; v_name text; v_mods jsonb;
  v_method payment_method; v_lines int; v_roll float; v_phone text;
  v_source order_source; v_staff_pick uuid; v_tax int; v_svc int; v_total int;
  i int; j int;
begin
  select id into v_owner from auth.users where email = v_owner_email;
  if v_owner is null then
    raise exception 'Owner account % not found — edit v_owner_email at the top', v_owner_email;
  end if;

  if to_regclass('public.table_sessions') is null then
    raise exception 'table_sessions not found — run migrations/0012_table_sessions_notifications.sql first, then reseed';
  end if;

  -- ── WIPE previous demo (cascade cleans menu/orders/payments/loyalty/etc.) ──
  delete from cafes where id = v_cafe and is_demo = true;

  -- ── CAFÉ ───────────────────────────────────────────────────────────────────
  insert into cafes (id, owner_id, slug, name, business_type, phone, address, city, state,
                     pincode, country, gstin, currency, timezone, dine_in, takeaway, delivery,
                     tax_percent, service_charge, plan, upsell_threshold, is_demo,
                     cash_management_enabled)
  values (v_cafe, v_owner, 'brewora', 'Brewora Café', 'cafe', '9876500001',
          'SCO 12, Sector 14 Market', 'Hisar', 'Haryana', '125001', 'IN',
          '06AABCB1234F1Z5', 'INR', 'Asia/Kolkata', true, true, false,
          5.00, 0.00, 'pro', 199, true,
          true);

  insert into cafe_settings (cafe_id, loyalty, receipt, notify) values (v_cafe,
    '{"name":"Brewora Rewards","earn_per_100":10,"min_spend":0,"expiry_days":365,"min_redeem_points":100,"max_redeem_pct":20,"points_to_rupee":0.10}',
    '{"footer":"Thank you for visiting Brewora Café!","gstin":"06AABCB1234F1Z5"}',
    '{"order_sound":true,"hours":"9:00-23:00"}');

  -- ── STAFF (owner = your real account; 5 demo users with unloggable random
  --     bcrypt passwords — they exist for RBAC/display, not for login) ────────
  insert into cafe_members (cafe_id, user_id, role, status)
  values (v_cafe, v_owner, 'owner', 'active');

  for v_s in select * from jsonb_array_elements(v_staff) loop
    begin
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                              email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                              created_at, updated_at)
      values ('00000000-0000-0000-0000-000000000000', (v_s->>'id')::uuid, 'authenticated',
              'authenticated', v_s->>'email',
              crypt(gen_random_uuid()::text, gen_salt('bf')), now(),
              '{"provider":"email","providers":["email"]}',
              jsonb_build_object('full_name', v_s->>'name', 'is_demo', true),
              now(), now())
      on conflict (id) do nothing;
    exception when others then
      raise notice 'demo staff user % skipped: %', v_s->>'email', sqlerrm;
    end;
    -- profile exists via signup trigger; ensure anyway, then membership
    insert into profiles (id, full_name, email)
    values ((v_s->>'id')::uuid, v_s->>'name', v_s->>'email')
    on conflict (id) do nothing;
    insert into cafe_members (cafe_id, user_id, role, status)
    select v_cafe, (v_s->>'id')::uuid, (v_s->>'role')::member_role, 'active'
    where exists (select 1 from profiles where id = (v_s->>'id')::uuid)
    on conflict do nothing;
  end loop;

  -- ── TABLES T01–T12 (capacities 2/4/6/8, QR token per table) ────────────────
  for i in 1..12 loop
    insert into cafe_tables (cafe_id, label, capacity, token)
    values (v_cafe, 'T' || lpad(i::text, 2, '0'),
            (array[2,4,2,4,6,4,2,8,4,6,2,8])[i],
            'brewora-t' || lpad(i::text, 2, '0'));
  end loop;

  -- ── MENU ───────────────────────────────────────────────────────────────────
  insert into menu_categories (cafe_id, name, sort) values (v_cafe, 'Burgers', 1)      returning id into c_bur;
  insert into menu_categories (cafe_id, name, sort) values (v_cafe, 'Pizza', 2)        returning id into c_piz;
  insert into menu_categories (cafe_id, name, sort) values (v_cafe, 'Coffee', 3)       returning id into c_cof;
  insert into menu_categories (cafe_id, name, sort) values (v_cafe, 'Soft Drinks', 4) returning id into c_drk;
  insert into menu_categories (cafe_id, name, sort) values (v_cafe, 'Fries', 5)        returning id into c_fri;
  insert into menu_categories (cafe_id, name, sort) values (v_cafe, 'Sandwiches', 6)   returning id into c_san;
  insert into menu_categories (cafe_id, name, sort) values (v_cafe, 'Desserts', 7)     returning id into c_des;

  insert into menu_items (cafe_id, category_id, name, description, price, is_veg, is_bestseller, prep_minutes, sort, is_upsell, upsell_pitch) values
  (v_cafe, c_bur,  'Classic Veg Burger',  'Crisp veg patty, lettuce, house sauce',            149, true, false, 12,  1, false, null),
  (v_cafe, c_bur,  'Cheese Burger',       'Veg patty with double cheddar',                    179, true, true,  12,  2, false, null),
  (v_cafe, c_bur,  'Paneer Tikka Burger', 'Char-grilled paneer tikka, mint mayo',             199, true, false, 14,  3, false, null),
  (v_cafe, c_bur,  'Double Patty Burger', 'Two patties, extra cheese, serious hunger',        229, true, false, 15,  4, false, null),
  (v_cafe, c_piz,  'Margherita',          'Classic tomato, mozzarella and basil',             199, true, true,  18,  5, false, null),
  (v_cafe, c_piz,  'Farmhouse',           'Onion, capsicum, tomato and mushroom',             249, true, false, 18,  6, false, null),
  (v_cafe, c_piz,  'Paneer Tikka Pizza',  'Tandoori paneer, onions, mint drizzle',            269, true, false, 20,  7, false, null),
  (v_cafe, c_piz,  'Cheese Corn Pizza',   'Sweet corn under a blanket of cheese',             229, true, false, 18,  8, false, null),
  (v_cafe, c_cof,  'Espresso',            'Single shot of intense, aromatic espresso',         99, true, false, 4,   9, false, null),
  (v_cafe, c_cof,  'Americano',           'Espresso lengthened with hot water',               119, true, false, 4,  10, false, null),
  (v_cafe, c_cof,  'Cappuccino',          'Espresso with steamed milk and thick foam',        149, true, true,  6,  11, false, null),
  (v_cafe, c_cof,  'Café Latte',          'Smooth espresso with silky steamed milk',          159, true, false, 6,  12, false, null),
  (v_cafe, c_cof,  'Mocha',               'Espresso, chocolate and steamed milk',             179, true, false, 7,  13, false, null),
  (v_cafe, c_cof,  'Caramel Latte',       'Latte sweetened with house caramel',               189, true, false, 7,  14, false, null),
  (v_cafe, c_cof,  'Classic Cold Coffee', 'Chilled, frothy and made with real ice cream',     169, true, true,  6,  15, false, null),
  (v_cafe, c_cof,  'Hazelnut Cold Coffee','Cold coffee with roasted hazelnut syrup',          199, true, false, 6,  16, false, null),
  (v_cafe, c_cof,  'Caramel Frappe',      'Blended ice, coffee and caramel drizzle',          219, true, false, 8,  17, false, null),
  (v_cafe, c_cof,  'Mocha Frappe',        'Chocolate-coffee frappe topped with cream',        229, true, false, 8,  18, false, null),
  (v_cafe, c_cof,  'Iced Americano',      'Espresso over ice — clean and strong',             139, true, false, 4,  19, false, null),
  (v_cafe, c_drk,  'Lemon Iced Tea',      'Fresh brewed tea, lemon and mint',                 129, true, false, 5,  20, false, null),
  (v_cafe, c_drk,  'Peach Iced Tea',      'Iced tea with real peach purée',                   139, true, false, 5,  21, false, null),
  (v_cafe, c_drk,  'Fresh Lime Soda',     'Sweet, salted or mixed — you choose',              119, true, false, 4,  22, false, null),
  (v_cafe, c_drk,  'Coca-Cola',           'Chilled 300ml bottle',                              49, true, false, 1,  23, false, null),
  (v_cafe, c_drk,  'Sprite',              'Chilled 300ml bottle',                              49, true, false, 1,  24, false, null),
  (v_cafe, c_fri,  'French Fries',        'Crisp golden fries, lightly salted',               129, true, true,  8,  25, false, null),
  (v_cafe, c_fri,  'Peri Peri Fries',     'Fries tossed in fiery peri peri',                  149, true, false, 8,  26, false, null),
  (v_cafe, c_fri,  'Cheese Fries',        'Fries drowned in cheese sauce',                     179, true, false, 9,  27, false, null),
  (v_cafe, c_san,  'Veg Grilled Sandwich','Triple-layer grilled classic',                      149, true, false, 10, 28, false, null),
  (v_cafe, c_san,  'Cheese Corn Sandwich','Corn, cheese and herbs, grilled golden',            169, true, false, 10, 29, false, null),
  (v_cafe, c_san,  'Paneer Tikka Sandwich','Spiced paneer tikka filling',                      189, true, false, 12, 30, false, null),
  (v_cafe, c_san,  'Club Sandwich',       'Triple-decker with fries on the side',              219, true, false, 14, 31, false, null),
  (v_cafe, c_des,  'Chocolate Brownie',   'Dense, fudgy, baked in-house',                      149, true, true,  3,  32, true,  'Add a warm brownie'),
  (v_cafe, c_des,  'Brownie with Ice Cream','Warm brownie, vanilla scoop, chocolate sauce',    199, true, false, 5,  33, false, null),
  (v_cafe, c_des,  'New York Cheesecake', 'Baked cheesecake, berry compote',                   229, true, false, 3,  34, false, null),
  (v_cafe, c_des,  'Chocolate Lava Cake', 'Molten centre, 100% guilt',                         179, true, false, 8,  35, true,  'Finish with a lava cake');

  -- Variants: Regular/Large on all coffees
  insert into menu_item_variants (menu_item_id, name, price_delta, sort)
  select id, 'Regular', 0, 0 from menu_items where cafe_id = v_cafe and category_id = c_cof;
  insert into menu_item_variants (menu_item_id, name, price_delta, sort)
  select id, 'Large', 45, 1 from menu_items where cafe_id = v_cafe and category_id = c_cof;

  -- Add-ons
  insert into menu_item_addons (menu_item_id, name, price, sort)
  select id, a.name, a.price, a.sort from menu_items mi,
    (values ('Extra Espresso Shot',40,0),('Oat Milk',50,1),('Almond Milk',60,2),('No Sugar',0,3),('Less Sugar',0,4)) as a(name,price,sort)
  where mi.cafe_id = v_cafe and mi.category_id = c_cof;
  insert into menu_item_addons (menu_item_id, name, price, sort)
  select id, a.name, a.price, a.sort from menu_items mi,
    (values ('Extra Cheese',30,0),('Jalapeño',30,1),('Olives',30,2)) as a(name,price,sort)
  where mi.cafe_id = v_cafe and mi.category_id in (c_bur, c_piz, c_san);
  insert into menu_item_addons (menu_item_id, name, price, sort)
  select id, 'Extra Patty', 60, 3 from menu_items where cafe_id = v_cafe and category_id = c_bur;
  insert into menu_item_addons (menu_item_id, name, price, sort)
  select id, 'Peri Peri Sprinkle', 20, 0 from menu_items where cafe_id = v_cafe and category_id = c_fri;

  -- ── CUSTOMERS (20; phones are reserved-range style demo numbers) ───────────
  insert into customers (cafe_id, name, phone)
  select v_cafe, n, '98300001' || lpad(row_number() over ()::text, 2, '0')
  from unnest(array['Aarav Gupta','Ishita Rana','Vikram Saini','Sneha Chauhan','Rahul Bishnoi',
                    'Pooja Jangra','Deepak Sharma','Ananya Verma','Mohit Sangwan','Kavya Malik',
                    'Sahil Punia','Ritu Godara','Nikhil Beniwal','Simran Kaur','Arpit Lamba',
                    'Tanvi Sheoran','Gaurav Duhan','Mansi Phogat','Yash Sihag','Divya Nain']) as n;

  -- ── 100 HISTORICAL ORDERS over the last 30 days ────────────────────────────
  for i in 1..100 loop
    v_ts := date_trunc('day', now()) - ((random()*29)::int || ' days')::interval
            + interval '9 hours' + (random()*13*3600)::int * interval '1 second';
    if v_ts > now() then v_ts := now() - interval '2 hours'; end if;

    v_cust := null; v_phone := null;
    if random() < 0.7 then
      select id, phone into v_cust, v_phone from customers where cafe_id = v_cafe order by random() limit 1;
    end if;
    select id into v_table from cafe_tables where cafe_id = v_cafe order by random() limit 1;
    v_type := case when random() < 0.65 then 'dine_in' else 'takeaway' end;
    v_status := case when random() < 0.93 then 'completed' else 'cancelled' end;

    -- Realistic source mix: most dine-in comes through the table QR, most
    -- takeaway is a walk-in a cashier rings up at the counter. 'staff' is a
    -- valid enum value but no code path ever writes it, so it's never rolled.
    v_source := case when v_type = 'takeaway' or random() < 0.35 then 'pos' else 'qr' end;
    v_staff_pick := case when v_source = 'pos'
      then (array['c0ffee00-0000-4000-a000-00000000a002','c0ffee00-0000-4000-a000-00000000a003'])[1 + (random()*2)::int]::uuid
      else null end;

    select count(*) + 1 into v_seq from orders where cafe_id = v_cafe and created_at::date = v_ts::date;

    insert into orders (cafe_id, table_id, customer_id, short_code, type, status, payment_status,
                        phone, subtotal, discount, total, created_at, source, staff_id)
    values (v_cafe, case when v_type = 'dine_in' then v_table end, v_cust, v_seq::text, v_type,
            v_status, 'unpaid', v_phone, 0, 0, 0, v_ts, v_source, v_staff_pick)
    returning id into v_order;

    v_sub := 0;
    v_lines := 1 + (random()*2)::int;
    for j in 1..v_lines loop
      select id, name, price into v_item from menu_items where cafe_id = v_cafe order by random() limit 1;
      v_qty := 1 + (random()*1.4)::int;
      v_unit := v_item.price; v_name := v_item.name; v_mods := '[]'::jsonb;
      if random() < 0.25 then
        select name, price_delta into v_var from menu_item_variants
          where menu_item_id = v_item.id and price_delta > 0 limit 1;
        if v_var.name is not null then
          v_unit := v_unit + v_var.price_delta;
          v_name := v_name || ' (' || v_var.name || ')';
          v_mods := jsonb_build_array(jsonb_build_object('name', v_var.name, 'price', v_var.price_delta));
        end if;
      end if;
      insert into order_items (order_id, menu_item_id, name, price, qty, modifiers)
      values (v_order, v_item.id, v_name, v_unit, v_qty, v_mods);
      v_sub := v_sub + v_unit * v_qty;
    end loop;

    -- occasional coupon discount (subtotal − discount = total, always)
    v_disc := 0; v_code := null;
    if v_sub >= 299 and random() < 0.15 then
      v_disc := least((v_sub * 0.20)::int, 150); v_code := 'WELCOME20';
    elsif v_sub >= 199 and random() < 0.10 then
      v_disc := least((v_sub * 0.10)::int, 80); v_code := 'COFFEE10';
    end if;

    -- Same compute_bill() the real order engine uses — not reimplemented here,
    -- so seeded historical orders carry real tax instead of a hardcoded 0.
    select tax, service_charge, total into v_tax, v_svc, v_total from compute_bill(v_cafe, v_sub, v_disc);

    if v_status = 'completed' then
      -- NO UPI: it is not enabled in the product, so demo data must not show it.
      v_roll := random();
      v_method := case when v_roll < 0.65 then 'cash' else 'card' end;
      update orders set subtotal = v_sub, discount = v_disc, tax = v_tax, service_charge = v_svc,
                        total = v_total, coupon_code = v_code, payment_status = 'paid',
                        payment_method = v_method, done_at = v_ts + interval '25 minutes'
        where id = v_order;
      insert into payments (cafe_id, order_id, method, amount, created_at)
      values (v_cafe, v_order, v_method, v_total, v_ts + interval '20 minutes');
    else
      update orders set subtotal = v_sub, discount = v_disc, tax = v_tax, service_charge = v_svc,
                        total = v_total, coupon_code = v_code where id = v_order;
    end if;
  end loop;

  -- ── 4 ACTIVE table sessions for the live floor view + KDS ──────────────────
  -- Distinct tables (not T09, which stays reserved above) so the floor view
  -- shows four genuinely different occupied cards, including one bill-
  -- requested (purple) and one flagged for assistance (red) per spec §3/§37.
  declare
    v_demo_tables uuid[];
    v_session_id uuid;
  begin
    select array_agg(id) into v_demo_tables from (
      select id from cafe_tables where cafe_id = v_cafe and label <> 'T09' order by random() limit 4
    ) x;

    for i in 1..4 loop
      v_table := v_demo_tables[i];
      v_ts := now() - ((array[2, 6, 11, 16])[i] || ' minutes')::interval;

      insert into table_sessions (cafe_id, table_id, status, guest_count, started_at)
      values (v_cafe, v_table, case when i = 4 then 'bill_requested' else 'active' end,
              2 + (random()*2)::int, v_ts)
      returning id into v_session_id;
      update cafe_tables set status = 'occupied' where id = v_table;

      select id, phone into v_cust, v_phone from customers where cafe_id = v_cafe order by random() limit 1;
      select count(*) + 1 into v_seq from orders where cafe_id = v_cafe and created_at::date = v_ts::date;

      insert into orders (cafe_id, table_id, session_id, customer_id, short_code, type, status, payment_status,
                          payment_method, phone, subtotal, total, created_at)
      values (v_cafe, v_table, v_session_id, v_cust, v_seq::text, 'dine_in',
              (array['placed','placed','preparing','ready'])[i]::order_status,
              (case when i = 3 then 'paid' else 'unpaid' end)::payment_status,
              (case when i = 3 then 'cash' else 'counter' end)::payment_method, v_phone, 0, 0, v_ts)
      returning id into v_order;

      v_sub := 0;
      for j in 1..2 loop
        select id, name, price into v_item from menu_items where cafe_id = v_cafe order by random() limit 1;
        insert into order_items (order_id, menu_item_id, name, price, qty, modifiers)
        values (v_order, v_item.id, v_item.name, v_item.price, 1, '[]');
        v_sub := v_sub + v_item.price;
      end loop;
      select tax, service_charge, total into v_tax, v_svc, v_total from compute_bill(v_cafe, v_sub, 0);
      update orders set subtotal = v_sub, tax = v_tax, service_charge = v_svc, total = v_total where id = v_order;
      if i = 3 then
        insert into payments (cafe_id, session_id, order_id, method, amount, created_at)
        values (v_cafe, v_session_id, v_order, 'cash', v_total, v_ts + interval '1 minute');
      end if;

      if i = 4 then
        insert into notifications (cafe_id, type, message, table_id, session_id)
        select v_cafe, 'bill_requested', 'Table ' || t.label || ' requested the bill.', v_table, v_session_id
        from cafe_tables t where t.id = v_table;
      end if;
      if i = 2 then
        insert into notifications (cafe_id, type, message, table_id, session_id)
        select v_cafe, 'call_waiter', 'Table ' || t.label || ' requires assistance.', v_table, v_session_id
        from cafe_tables t where t.id = v_table;
      end if;
      insert into notifications (cafe_id, type, message, table_id, session_id)
      select v_cafe, 'new_order', 'Table ' || t.label || ' placed a new order — #' || v_seq, v_table, v_session_id
      from cafe_tables t where t.id = v_table;
    end loop;
  end;

  -- ── LOYALTY: Brewora Rewards — earn 1 pt per ₹10 on completed orders ───────
  insert into loyalty_accounts (cafe_id, customer_id)
  select distinct v_cafe, customer_id from orders
  where cafe_id = v_cafe and customer_id is not null and status = 'completed'
  on conflict do nothing;

  insert into loyalty_transactions (cafe_id, account_id, order_id, kind, points, reason, created_at)
  select v_cafe, la.id, o.id, 'earn', floor(o.total / 10.0)::int, 'Order #' || o.short_code, o.created_at
  from orders o
  join loyalty_accounts la on la.cafe_id = v_cafe and la.customer_id = o.customer_id
  where o.cafe_id = v_cafe and o.status = 'completed' and o.customer_id is not null;

  -- two redemptions for realism
  insert into loyalty_transactions (cafe_id, account_id, kind, points, reason, created_at)
  select v_cafe, account_id, 'redeem', -100, 'Redeemed ₹10 off', now() - interval '3 days'
  from v_loyalty_balance where cafe_id = v_cafe and balance >= 150 limit 2;

  -- customer first/last visit from their actual orders
  update customers c set first_seen = s.mn, last_seen = s.mx
  from (select customer_id, min(created_at) mn, max(created_at) mx
        from orders where cafe_id = v_cafe and customer_id is not null group by 1) s
  where c.id = s.customer_id and c.cafe_id = v_cafe;

  -- ── COUPONS (seeded + valid; note: checkout has no coupon input yet) ───────
  insert into coupons (cafe_id, code, name, kind, value, min_order, max_discount, starts_at, ends_at, usage_limit, per_customer, active) values
  (v_cafe, 'WELCOME20', 'Welcome offer — 20% off',  'percent', 20, 299, 150, now() - interval '10 days', now() + interval '80 days', 500, 1, true),
  (v_cafe, 'COFFEE10',  'Coffee lovers — 10% off',  'percent', 10, 199,  80, now() - interval '10 days', now() + interval '80 days', 1000, 5, true),
  (v_cafe, 'SAVE100',   'Flat ₹100 off big orders', 'flat',   100, 599, 100, now() - interval '10 days', now() + interval '80 days', 200, 2, true),
  (v_cafe, 'WEEKEND15', 'Weekend special — 15%',    'percent', 15, 499, 200, now() + interval '2 days',  now() + interval '90 days', 300, 3, true);

  -- ── Reserved table example (floor view amber state) ────────────────────────
  update cafe_tables set status = 'reserved' where cafe_id = v_cafe and label = 'T09';

  -- ── SMS delivery examples (requires migration 0010; skipped gracefully) ────
  -- One simulated success (clearly provider 'mock') and one honest failure.
  begin
    insert into sms_logs (cafe_id, order_id, customer_id, phone_masked, type, provider, status, sent_at)
    select v_cafe, o.id, o.customer_id, '******' || right(o.phone, 4), 'bill', 'mock', 'sent', o.created_at + interval '30 minutes'
    from orders o where o.cafe_id = v_cafe and o.status = 'completed' and o.phone is not null
    order by o.created_at desc limit 1;

    insert into sms_logs (cafe_id, order_id, customer_id, phone_masked, type, provider, status, error, failed_at)
    select v_cafe, o.id, o.customer_id, '******' || right(o.phone, 4), 'bill', 'none', 'failed',
           'SMS provider not configured', o.created_at + interval '30 minutes'
    from orders o where o.cafe_id = v_cafe and o.status = 'completed' and o.phone is not null
    order by o.created_at desc offset 1 limit 1;
  exception when undefined_table then
    raise notice 'sms_logs not found — run migration 0010, then reseed for SMS examples';
  end;

  raise notice 'Brewora Café seeded. Owner: % · QR test: /t/brewora-t01', v_owner_email;
end $$;
