-- Removes ONLY the demo café and everything under it. Real cafés are untouched:
-- the delete is pinned to the fixed demo id AND the is_demo flag, and every
-- child row (menu, orders, payments, loyalty, customers, tables, members,
-- settings, coupons) cascades from cafes. Demo staff auth users are removed by
-- their fixed ids; their profiles cascade from auth.users.
-- To reseed afterwards, run seed-demo-cafe.sql again.

delete from cafes where id = 'c0ffee00-0000-4000-a000-000000000001' and is_demo = true;

delete from auth.users where id in (
  'c0ffee00-0000-4000-a000-00000000a002',
  'c0ffee00-0000-4000-a000-00000000a003',
  'c0ffee00-0000-4000-a000-00000000a004',
  'c0ffee00-0000-4000-a000-00000000a005',
  'c0ffee00-0000-4000-a000-00000000a006'
) and (raw_user_meta_data->>'is_demo')::boolean = true;
