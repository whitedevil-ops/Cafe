-- ============================================================================
-- SCHEMA DRIFT CHECK — run any time, read-only, instant.
-- Lists every object the deployed code depends on and whether prod has it.
-- Any row with present = false names the migration to run. After running
-- migrations, re-run this until every row is true.
-- ============================================================================

with expected(kind, name, fix) as (values
  -- core (0001)
  ('table',    'cafes',                'schema.sql / 0001'),
  ('table',    'cafe_members',         'schema.sql / 0001'),
  ('table',    'menu_categories',      'schema.sql / 0001'),
  ('table',    'menu_items',           'schema.sql / 0001'),
  ('table',    'menu_item_variants',   'schema.sql / 0001'),
  ('table',    'menu_item_addons',     'schema.sql / 0001'),
  ('table',    'cafe_tables',          'schema.sql / 0001'),
  ('table',    'customers',            'schema.sql / 0001'),
  ('table',    'orders',               'schema.sql / 0001'),
  ('table',    'order_items',          'schema.sql / 0001'),
  ('table',    'payments',             'schema.sql / 0001'),
  ('table',    'cafe_settings',        'schema.sql / 0001'),
  ('function', 'is_cafe_member',       '0001'),
  ('function', 'has_cafe_role',        '0001'),
  ('function', 'handle_new_user',      '0001'),
  -- ordering (0002/0003/0009/0010)
  ('function', 'place_order',          '0002..0010 (latest: 0010)'),
  -- platform admin
  ('table',    'platform_admins',      'platform-admin.sql'),
  ('function', 'is_platform_admin',    'platform-admin.sql'),
  -- 0005/0006/0008 column repairs
  ('column',   'cafes.is_demo',        '0005'),
  ('column',   'orders.payment_method','0006'),
  ('column',   'orders.phone',         '0006'),
  ('column',   'cafes.upi_id',         '0008'),
  ('column',   'cafes.upi_name',       '0008'),
  -- staff invites (0007)
  ('table',    'cafe_invites',         '0007'),
  ('function', 'claim_my_invites',     '0007'),
  -- receipts + SMS (0010)
  ('column',   'orders.receipt_token', '0010'),
  ('table',    'sms_logs',             '0010'),
  ('function', 'get_receipt',          '0010'),
  ('function', 'enqueue_bill_sms',     '0010'),
  -- café profile + bill link (0011)
  ('column',   'cafes.description',    '0011'),
  ('column',   'cafes.email',          '0011'),
  ('column',   'cafes.website',        '0011'),
  ('column',   'cafe_settings.hours',  '0011'),
  -- table sessions, notifications, request bill/call waiter, move table (0012)
  ('table',    'table_sessions',       '0012'),
  ('table',    'notifications',        '0012'),
  ('column',   'orders.session_id',    '0012'),
  ('column',   'payments.session_id',  '0012'),
  ('function', 'get_or_create_session','0012'),
  ('function', 'request_bill',         '0012'),
  ('function', 'call_waiter',          '0012'),
  ('function', 'move_session',         '0012'),
  ('function', 'close_session',        '0012'),
  -- staff cashier POS order creation (0013)
  ('column',   'orders.staff_id',      '0013'),
  ('function', 'staff_place_order',    '0013')
)
select
  e.kind,
  e.name,
  case e.kind
    when 'table' then exists (
      select 1 from information_schema.tables t
      where t.table_schema = 'public' and t.table_name = e.name)
    when 'column' then exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = split_part(e.name, '.', 1)
        and c.column_name = split_part(e.name, '.', 2))
    when 'function' then exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = e.name)
  end as present,
  e.fix as run_this_if_missing
from expected e
order by 3, 1, 2;
