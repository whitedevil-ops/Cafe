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
  ('function', 'place_order',          '0002..0016 (latest: 0016)'),
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
  ('function', 'staff_place_order',    '0013..0016 (latest: 0016)'),
  -- counter POS billing engine: source tagging, discounts, held orders,
  -- customer lookup, audit logging (0016)
  ('column',   'orders.source',        '0016'),
  ('function', 'compute_bill',         '0016'),
  ('table',    'held_orders',          '0016'),
  ('function', 'pos_lookup_customer',  '0016'),
  ('function', 'audit_payment_recorded', '0016'),
  ('function', 'audit_order_cancelled',  '0016..0017 (latest: 0017)'),
  -- order cancellation with a required reason (0017)
  ('column',   'orders.cancel_reason',  '0017'),
  ('function', 'cancel_order',          '0017'),
  -- customer CRM segments (0018)
  ('table',    'v_customer_stats',      '0018'),
  -- platform operator panel (0019/0020)
  ('column',   'cafes.verified',         '0019'),
  ('column',   'cafes.status',           '0019'),
  ('column',   'cafes.subscription_ends_at', '0019'),
  ('function', 'is_cafe_member_any_status', '0019'),
  ('table',    'platform_plans',         '0019'),
  ('table',    'cafe_feature_overrides', '0019'),
  ('function', 'cafe_has_feature',       '0019'),
  ('table',    'operator_notes',         '0019'),
  ('table',    'password_reset_log',     '0019'),
  ('table',    'v_cafe_onboarding',      '0019'),
  ('function', 'op_verify_cafe',         '0019'),
  ('function', 'op_set_cafe_status',     '0019'),
  ('function', 'op_change_plan',         '0019'),
  ('function', 'op_extend_subscription', '0019'),
  ('function', 'op_set_feature_override', '0019'),
  ('function', 'op_add_operator_note',   '0019'),
  ('function', 'op_platform_overview',   '0020'),
  ('function', 'op_list_cafes',          '0020'),
  ('function', 'op_get_cafe_detail',     '0020'),
  ('function', 'op_cafe_health',         '0020'),
  ('function', 'op_log_password_reset',  '0021'),
  -- per-café business timezone (0026)
  ('function', 'cafe_day_start',          '0026'),
  -- customer order history + phone verification (0023)
  ('table',    'customer_otp_challenges', '0023'),
  ('table',    'customer_sessions',       '0023'),
  ('function', 'customer_issue_otp',      '0023'),
  ('function', 'customer_verify_otp',     '0023'),
  ('function', 'customer_session_identity', '0023'),
  ('function', 'customer_order_history',  '0023'),
  ('function', 'customer_reorder_payload', '0023'),
  -- optional KOT printing (0027)
  ('column',   'cafes.kot_printing_enabled', '0027'),
  ('table',    'kitchen_stations',        '0027'),
  ('table',    'kot_printers',            '0027'),
  ('table',    'print_jobs',              '0027'),
  ('table',    'print_bridge_tokens',     '0027'),
  ('function', 'build_kot_payload',       '0027'),
  ('function', 'enqueue_kot_jobs',        '0027'),
  ('function', 'reprint_kot',             '0027'),
  ('function', 'bridge_claim_jobs',       '0027'),
  ('function', 'printer_health',          '0027'),
  -- refunds (0028)
  ('column',   'cafes.refund_approval_limit', '0028'),
  ('table',    'refunds',                 '0028'),
  ('table',    'refund_items',            '0028'),
  ('function', 'refund_order',            '0028'),
  ('function', 'order_refunded_total',    '0028'),
  ('function', 'order_settlement',        '0028'),
  -- shift + cash register (0029)
  ('table',    'cash_shifts',             '0029'),
  ('table',    'cash_movements',          '0029'),
  ('function', 'open_shift',              '0029'),
  ('function', 'close_shift',             '0029'),
  ('function', 'record_cash_movement',    '0029'),
  ('function', 'shift_summary',           '0029'),
  ('function', 'current_shift',           '0029'),
  ('function', 'recent_shifts',           '0029'),
  -- cash management made optional (0030)
  ('column',   'cafes.cash_management_enabled', '0030'),
  -- GST invoice (0031)
  ('column',   'cafes.gst_sac_code',            '0031'),
  ('column',   'orders.gst_invoice_number',     '0031'),
  ('column',   'orders.gst_invoice_issued_at',  '0031'),
  ('table',    'gst_invoice_counters',          '0031'),
  ('function', 'gst_financial_year',            '0031'),
  ('function', 'claim_gst_invoice_number',      '0031'),
  ('function', 'assign_gst_invoice_number',     '0031'),
  -- sales reports (0032; extended 0034 to fold in expenses/net_profit —
  -- expenses itself is pre-existing base schema, not new here)
  ('function', 'sales_report',                  '0032'),
  -- inventory movement + low-stock (0035; inventory_items/inventory_transactions
  -- themselves are pre-existing base schema, not new here)
  ('function', 'record_inventory_movement',     '0035'),
  ('function', 'low_stock_items',               '0035'),
  -- recipes / bill of materials + food costing (0036)
  ('table',    'recipe_items',                  '0036'),
  ('function', 'menu_item_costs',               '0036'),
  ('column',   'cafes.auto_deduct_stock',       '0036'),
  ('function', 'deduct_stock_for_order_item',   '0036'),
  -- GST configuration + per-item tax (0037/0038)
  ('column',   'cafes.gst_registered',          '0037'),
  ('column',   'cafes.legal_name',              '0037'),
  ('column',   'cafes.trade_name',              '0037'),
  ('column',   'cafes.state_code',              '0037'),
  ('column',   'cafes.invoice_prefix',          '0037'),
  ('column',   'cafes.tax_inclusive',           '0037'),
  ('column',   'menu_items.hsn_sac',            '0037'),
  ('column',   'order_items.tax_percent',       '0037'),
  ('column',   'order_items.taxable_value',     '0037'),
  ('column',   'order_items.tax_amount',        '0037'),
  ('column',   'order_items.hsn_sac',           '0037'),
  ('function', 'is_valid_gstin',                '0037'),
  ('function', 'apply_order_taxes',             '0037'),
  ('function', 'snapshot_order_item_tax',       '0037'),
  -- central bills module (0039)
  ('function', 'bill_status',                   '0039'),
  ('function', 'list_bills',                    '0039'),
  ('function', 'bill_detail',                   '0039'),
  -- payment config + attempts + RPCs (0040/0041/0042)
  ('column',   'cafes.upi_enabled',             '0040'),
  ('column',   'cafes.qr_payment_mode',         '0040'),
  ('column',   'cafes.payment_qr_url',          '0040'),
  ('column',   'payments.reference',            '0040'),
  ('column',   'payments.confirmed_by',         '0040'),
  ('column',   'payments.source',               '0040'),
  ('table',    'payment_attempts',              '0040'),
  ('function', 'order_outstanding',             '0041'),
  ('function', 'recompute_order_payment_status','0041'),
  ('function', 'record_payment',                '0041'),
  ('function', 'qr_start_upi_payment',          '0041'),
  ('function', 'qr_claim_payment',              '0041'),
  ('function', 'pending_payment_claims',        '0041'),
  ('function', 'outstanding_summary',           '0042'),
  -- payment methods + Razorpay abstraction (0045)
  ('column',   'cafes.accept_pay_counter',      '0045'),
  ('column',   'cafes.online_payments_enabled', '0045'),
  ('column',   'cafes.razorpay_status',         '0045'),
  ('column',   'cafes.razorpay_account_id',     '0045'),
  ('column',   'payments.status',               '0045'),
  ('column',   'payments.provider',             '0045'),
  ('column',   'payments.provider_payment_id',  '0045'),
  -- per-café Razorpay connect (0046)
  ('column',   'cafes.razorpay_key_id',         '0046'),
  ('column',   'cafes.razorpay_webhook_token',  '0046'),
  ('table',    'cafe_payment_secrets',          '0046'),
  ('function', 'set_cafe_razorpay',             '0046'),
  ('function', 'disconnect_cafe_razorpay',      '0046'),
  -- one payment-state model: payment-first placement + session settle (0047)
  ('function', 'record_session_payment',        '0047'),
  -- F-01 financial lockdown: expenses move to authorized RPCs (0050)
  ('function', 'record_expense',                '0050'),
  ('function', 'delete_expense',                '0050'),
  -- enabled-order-type enforcement trigger fn (0051)
  ('function', 'enforce_enabled_order_type',    '0051'),
  -- item cost + profitability (0052)
  ('column',   'menu_items.cost',               '0052'),
  ('column',   'menu_items.cost_source',        '0052'),
  ('column',   'order_items.cost_snapshot',     '0052'),
  ('function', 'menu_item_effective_cost',      '0052'),
  ('function', 'profitability_report',          '0052'),
  -- visual floor & table layout (0053)
  ('table',    'floor_areas',                   '0053'),
  ('column',   'cafe_tables.area_id',           '0053'),
  ('column',   'cafe_tables.pos_x',             '0053'),
  ('column',   'cafe_tables.pos_y',             '0053'),
  ('column',   'cafe_tables.shape',             '0053'),
  ('column',   'cafe_tables.archived',          '0053'),
  ('function', 'save_floor_layout',             '0053'),
  -- smart cross-sell recommendation engine (0055)
  ('column',   'cafes.recommendations_enabled', '0055'),
  ('table',    'menu_pairings',                 '0055'),
  ('table',    'category_pairings',             '0055'),
  ('table',    'order_pair_stats',              '0055'),
  ('table',    'recommendation_events',         '0055'),
  ('function', 'get_recommendations',           '0055'),
  ('function', 'set_item_pairings',             '0055'),
  ('function', 'set_category_pairings',         '0055'),
  ('function', 'refresh_order_pairings',        '0055'),
  ('function', 'log_recommendation_event',      '0055'),
  ('function', 'recommendation_report',         '0055'),
  -- duplicate-order guard (0056)
  ('column',   'orders.client_request_id',      '0056'),
  -- Reports V2, Report 1 (0057)
  ('function', 'business_overview_report',      '0057'),
  -- onboarding wizard (0058)
  ('column',   'cafes.onboarding_step',         '0058'),
  ('column',   'cafes.onboarding_meta',         '0058'),
  ('function', 'create_or_resume_onboarding_cafe', '0058'),
  -- plan-gated multi-café caps (0059)
  ('column',   'platform_plans.max_owned_cafes', '0059'),
  ('function', 'owned_cafe_capacity',           '0059'),
  -- inventory deduction reversal on cancellation (0060)
  ('function', 'reverse_stock_for_cancelled_order', '0060'),
  -- coupons & offers engine (0061)
  ('column',   'coupon_redemptions.discount_amount', '0061'),
  ('function', 'resolve_coupon_discount',        '0061'),
  ('function', 'validate_coupon',                '0061'),
  ('function', 'validate_coupon_public',         '0061'),
  ('function', 'coupon_stats',                   '0061'),
  -- coupon management (0062)
  ('function', 'create_coupon',                  '0062'),
  ('function', 'set_coupon_active',              '0062'),
  -- Reports V2, remaining five (0063)
  ('function', 'items_categories_report',        '0063'),
  ('function', 'payments_outstanding_report',    '0063'),
  ('function', 'gst_invoice_report',             '0063'),
  ('function', 'adjustments_report',             '0063'),
  ('function', 'operations_report',              '0063'),
  -- loyalty & rewards engine (0064)
  ('column',   'cafes.loyalty_enabled',          '0064'),
  ('column',   'cafes.loyalty_points_per_100',   '0064'),
  ('function', 'get_or_create_loyalty_account',  '0064'),
  ('function', 'earn_loyalty_points_on_payment', '0064'),
  ('function', 'redeem_reward',                  '0064'),
  ('function', 'adjust_loyalty_points',          '0064'),
  ('function', 'create_reward',                  '0064'),
  ('function', 'set_reward_active',              '0064'),
  -- notification centre (0066)
  ('column',   'notifications.order_id',         '0066'),
  ('function', 'notification_target_roles',      '0066'),
  ('function', 'notify_low_stock',                '0066'),
  ('function', 'flag_late_tickets',               '0066'),
  -- purchase & supplier management (0067)
  ('table',    'suppliers',                      '0067'),
  ('table',    'purchase_orders',                '0067'),
  ('table',    'purchase_order_items',           '0067'),
  ('function', 'create_supplier',                '0067'),
  ('function', 'set_supplier_active',             '0067'),
  ('function', 'create_purchase_order',          '0067'),
  ('function', 'receive_purchase_order_items',    '0067'),
  ('function', 'cancel_purchase_order',          '0067'),
  -- feedback app (0068)
  ('table',    'feedback',                       '0068'),
  ('function', 'submit_feedback',                '0068'),
  ('function', 'feedback_summary',               '0068'),
  -- P0 hardening: customers/cafe_settings lockdown, loyalty+coupon race
  -- fixes, inventory reversal ledger (0071)
  ('function', 'update_cafe_settings',           '0071'),
  ('column',   'inventory_transactions.order_item_id', '0071'),
  -- entitlement gating: seat caps (0073)
  ('column',   'platform_plans.max_staff',       '0073'),
  ('function', 'create_staff_invite',            '0073'),
  -- platform billing via Razorpay Subscriptions (0074)
  ('column',   'platform_plans.razorpay_plan_id', '0074'),
  ('column',   'cafes.razorpay_subscription_id', '0074'),
  ('column',   'cafes.billing_status',           '0074'),
  ('table',    'platform_billing_events',        '0074'),
  ('function', 'platform_billing_state',         '0074'),
  -- menu RBAC (0075)
  ('function', 'set_menu_item_availability',     '0075'),
  -- OTP IP-side throttle (0076)
  ('table',    'otp_ip_attempts',                '0076'),
  -- POS coupon suggestions (0077)
  ('function', 'list_applicable_coupons',        '0077'),
  -- coupon category scoping (0078)
  ('table',    'coupon_categories',              '0078'),
  ('function', 'set_coupon_categories',          '0078'),
  -- multi-admin roles & permissions (0079)
  ('column',   'platform_admins.full_name',      '0079'),
  ('column',   'platform_admins.email',          '0079'),
  ('column',   'platform_admins.permissions',    '0079'),
  ('column',   'platform_admins.created_by',     '0079'),
  ('column',   'platform_admins.updated_at',     '0079'),
  ('function', 'role_default_permissions',       '0079'),
  ('function', 'has_platform_permission',        '0079'),
  ('function', 'platform_admin_context',         '0079'),
  ('function', 'op_touch_admin_login',           '0079'),
  ('function', 'op_list_admins',                 '0079'),
  ('function', 'op_get_admin_detail',            '0079'),
  ('function', 'op_create_admin',                '0079'),
  ('function', 'op_update_admin',                '0079'),
  ('function', 'op_update_admin_permissions',    '0079'),
  ('function', 'op_set_admin_status',            '0079'),
  ('function', 'op_log_admin_password_reset',    '0079'),
  -- customer name edit (0080)
  ('function', 'update_customer_name',           '0080'),
  -- QR customer session gate, no OTP (0081)
  ('function', 'customer_start_session',         '0081'),
  -- real 3-tier pricing: Starter/Growth/Scale (0083)
  ('column',   'platform_plans.price_yearly',         '0083'),
  ('column',   'platform_plans.renewal_price_yearly', '0083'),
  -- QR ordering kill switch, anon-safe (0084)
  ('function', 'public_cafe_ordering_enabled',        '0084'),
  -- direct staff account creation, no email invite (0085)
  ('function', 'create_staff_member',                 '0085'),
  -- device-scoped customer identity (0087)
  ('column',   'customer_sessions.device_id',          '0087'),
  ('column',   'orders.device_id',                     '0087'),
  -- trusted-device registration, OTP required again (0088)
  ('table',    'customer_devices',                     '0088'),
  ('column',   'customer_sessions.device_row_id',       '0088'),
  ('function', 'customer_session_status',              '0088'),
  -- customer prepaid wallet (0091)
  ('table',    'wallet_topup_tiers',                   '0091'),
  ('table',    'wallet_transactions',                  '0091'),
  ('column',   'payment_attempts.purpose',              '0091'),
  ('function', 'customer_wallet_state',                '0091'),
  ('function', 'wallet_start_topup',                   '0091'),
  ('function', 'wallet_confirm_topup',                 '0091'),
  ('function', 'wallet_pay_order',                     '0091'),
  ('function', 'wallet_pay_for_order',                 '0091'),
  ('function', 'create_wallet_tier',                   '0091'),
  ('function', 'wallet_overview',                      '0091'),
  -- wallet cash top-ups (0093)
  ('column',   'wallet_transactions.source',            '0093'),
  ('column',   'wallet_transactions.paid_amount',        '0093'),
  ('function', 'wallet_cash_topup',                     '0093')
  -- op_list_cafes owner_id (0094) is a return-column change, not a new
  -- object — nothing new to check-schema here; the price update is data,
  -- not schema.
  -- per-role screen access (0096)
  ('table',    'cafe_role_screens',                    '0096'),
  ('function', 'default_role_screens',                 '0096'),
  ('function', 'all_screen_keys',                      '0096'),
  ('function', 'my_screen_access',                     '0096'),
  ('function', 'role_screen_overview',                 '0096'),
  ('function', 'set_role_screen',                      '0096')
  -- 0097/0098 are function-body/return-value fixes to already-registered
  -- objects (list_bills 0039, refund_order/order_settlement 0028) — nothing
  -- new to check-schema here.
  -- reservations (0100)
  ('table',    'reservations',                         '0100'),
  ('function', 'create_reservation',                   '0100'),
  ('function', 'set_reservation_status',                '0100'),
  ('function', 'list_reservations',                     '0100'),
  -- advanced analytics (0101)
  ('function', 'advanced_analytics_report',             '0101'),
  -- platform-admin café deletion (0102)
  ('table',    'cafe_deletions',                        '0102'),
  ('function', 'op_delete_cafe',                        '0102'),
  ('function', 'list_cafe_deletions',                   '0102'),
  -- 0103 is a function-body fix to an already-registered function
  -- (public_cafe_ordering_enabled, 0084) — nothing new to check-schema here.
  -- bulk bill/receipt export (0104)
  ('function', 'list_bill_receipts',                    '0104'),
  -- 0105 is a function-body fix to 0104 (CTE-scope bug) — nothing new here.
  -- per-variant cost (0106)
  ('column',   'menu_item_variants.cost_delta',         '0106'),
  ('column',   'order_items.variant_id',                '0106')
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
