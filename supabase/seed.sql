-- Development seed only.
-- Before any owner meeting this gets replaced with THAT cafe's menu, their prices,
-- their name. A demo running on "Demo Cafe" data is the thing every competitor does.

insert into cafes (id, slug, name, upi_id, upi_name, upsell_threshold) values
  ('11111111-1111-1111-1111-111111111111', 'brew-room', 'The Brew Room', 'brewroom@okhdfcbank', 'The Brew Room', 150);

insert into cafe_tables (cafe_id, label, token) values
  ('11111111-1111-1111-1111-111111111111', '1', 'brew-t1'),
  ('11111111-1111-1111-1111-111111111111', '2', 'brew-t2'),
  ('11111111-1111-1111-1111-111111111111', '3', 'brew-t3'),
  ('11111111-1111-1111-1111-111111111111', '4', 'brew-t4'),
  ('11111111-1111-1111-1111-111111111111', '5', 'brew-t5'),
  ('11111111-1111-1111-1111-111111111111', '6', 'brew-t6');

insert into menu_items (cafe_id, category, name, price, sort, is_upsell, upsell_pitch) values
  ('11111111-1111-1111-1111-111111111111', 'Coffee', 'Cappuccino',        140,  1, false, null),
  ('11111111-1111-1111-1111-111111111111', 'Coffee', 'Cafe Latte',        150,  2, false, null),
  ('11111111-1111-1111-1111-111111111111', 'Coffee', 'Cold Coffee',       180,  3, false, null),
  ('11111111-1111-1111-1111-111111111111', 'Coffee', 'Espresso',          110,  4, false, null),
  ('11111111-1111-1111-1111-111111111111', 'Coffee', 'Hazelnut Latte',    190,  5, false, null),
  ('11111111-1111-1111-1111-111111111111', 'Tea',    'Masala Chai',        70,  6, false, null),
  ('11111111-1111-1111-1111-111111111111', 'Tea',    'Green Tea',          90,  7, false, null),
  ('11111111-1111-1111-1111-111111111111', 'Food',   'Veg Sandwich',      160,  8, false, null),
  ('11111111-1111-1111-1111-111111111111', 'Food',   'Paneer Tikka Roll', 190,  9, false, null),
  ('11111111-1111-1111-1111-111111111111', 'Food',   'Peri Peri Fries',   130, 10, false, null),
  ('11111111-1111-1111-1111-111111111111', 'Food',   'Maggi Masala',      110, 11, false, null),
  ('11111111-1111-1111-1111-111111111111', 'Bakery', 'Chocolate Brownie',  60, 12, true,  'Add a warm brownie'),
  ('11111111-1111-1111-1111-111111111111', 'Bakery', 'Choco Chip Cookie',  40, 13, true,  'Add a cookie'),
  ('11111111-1111-1111-1111-111111111111', 'Bakery', 'Banana Bread',       70, 14, true,  'Add a slice of banana bread');
