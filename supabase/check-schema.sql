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
  ('column',   'order_items.variant_id',                '0106'),
  -- 0107 is a function-body fix to an already-registered function
  -- (get_recommendations, 0055) — nothing new to check-schema here.
  -- word-boundary keyword matching helper (0108)
  ('function', 'contains_word',                         '0108'),
  -- 0108 also re-bodies get_recommendations (already registered, 0055) —
  -- nothing further to check-schema for that part.
  -- Google review funnel (0109)
  ('column',   'cafes.google_review_url',               '0109'),
  -- 0109 also re-bodies get_receipt (already registered, 0039) — nothing
  -- further to check-schema for that part.
  -- Referral program (0110)
  ('column',   'cafes.referral_enabled',                '0110'),
  ('column',   'cafes.referral_reward_amount',           '0110'),
  ('column',   'customers.referral_code',                '0110'),
  ('table',    'customer_referrals',                     '0110'),
  ('function', 'customer_referral_state',                '0110'),
  ('function', 'list_referrals',                         '0110'),
  ('function', 'award_referral_reward_on_payment',        '0110'),
  -- 0110 also re-bodies customer_start_session (already registered, 0089)
  -- with an added 5th param — nothing further to check-schema for that part.
  -- referral gated to Scale plan (0111) is a data-only update to
  -- platform_plans.features — nothing new to check-schema there.
  -- backend entitlement enforcement for referral (0112)
  ('function', 'cafe_plan_feature',                       '0112'),
  -- 0112 also re-bodies customer_referral_state, award_referral_reward_on_
  -- payment, and customer_start_session (all already registered) —
  -- nothing further to check-schema for those parts.
  -- signup email OTP (0113)
  ('table',    'signup_otp_challenges',                   '0113'),
  ('function', 'issue_signup_otp',                        '0113'),
  ('function', 'verify_signup_otp',                       '0113'),
  -- plan-expiry reminder dedupe (0114)
  ('column',   'cafes.expiry_reminder_sent_at',            '0114'),
  -- 0114 also re-bodies op_extend_subscription (already registered, 0019) —
  -- nothing further to check-schema for that part.
  -- 30-day-out plan-expiry reminder dedupe (0115)
  ('column',   'cafes.expiry_reminder_30d_sent_at',        '0115'),
  -- 0115 also re-bodies op_extend_subscription (already registered, 0019) —
  -- nothing further to check-schema for that part.
  -- 0116 also re-bodies op_create_admin (already registered, 0079), adding
  -- the permission-key allowlist check — nothing further to check-schema for
  -- that part.
  -- leads instead of direct self-registration (0117)
  ('table',    'leads',                                  '0117'),
  ('table',    'lead_notification_emails',                '0117'),
  ('function', 'submit_lead',                             '0117'),
  ('function', 'op_list_leads',                            '0117'),
  ('function', 'op_update_lead_status',                    '0117'),
  ('function', 'op_list_lead_notification_emails',         '0117'),
  ('function', 'op_add_lead_notification_email',           '0117'),
  ('function', 'op_remove_lead_notification_email',        '0117'),
  -- 0117 also re-bodies role_default_permissions/op_update_admin_permissions/
  -- op_create_admin (already registered, 0079/0116) to add leads.view/
  -- leads.manage -- nothing further to check-schema for that part.
  -- trial auto-start + auto-calculated plan/renewal dates (0118)
  ('function', 'ensure_trial_started',                     '0118')
  -- 0118 also re-bodies op_change_plan (already registered, 0079) to add
  -- p_effective_date + auto-calculated subscription_ends_at, and
  -- op_extend_subscription (already registered, 0079) to restore its
  -- has_platform_permission('subscriptions.manage') check -- nothing
  -- further to check-schema for either part.
  --
  -- 0119 is a grant-only fix (wallet_confirm_topup 0091/0093 was reachable
  -- by `authenticated`, not just the intended service_role webhook caller)
  -- -- no new/renamed object, nothing further to check-schema for it.
  --
  -- reward redemption is now atomic + tied to a real menu item (0120)
  ('column',   'rewards.menu_item_id',                   '0120'),
  ('column',   'rewards.variant_id',                      '0120'),
  ('column',   'order_items.reward_id',                   '0120')
  -- 0120 also re-bodies create_reward (already registered, 0064) with two
  -- new required/optional params, staff_place_order (already registered,
  -- 0016) to redeem a reward atomically inside the order, and get_receipt
  -- (already registered, 0010) to add an is_reward flag per item -- nothing
  -- further to check-schema for any of those three.
  --
  -- 0121 makes rewards.menu_item_id optional again (re-bodies create_reward,
  -- already registered, 0064) -- same type signature as 0120, no new
  -- object, nothing further to check-schema for it.
  --
  -- lets owner/manager hard-delete a reward, not just deactivate (0122)
  ('function', 'delete_reward',                            '0122'),
  -- combo meals / bundle deals (0123)
  ('table',    'combos',                                   '0123'),
  ('table',    'combo_slots',                              '0123'),
  ('column',   'order_items.combo_id',                     '0123'),
  ('column',   'order_items.combo_group',                  '0123'),
  ('function', 'expand_combo_line',                        '0123'),
  ('function', 'sync_combo_slots',                         '0123'),
  ('function', 'create_combo',                             '0123'),
  ('function', 'update_combo',                             '0123'),
  ('function', 'set_combo_active',                         '0123'),
  ('function', 'delete_combo',                             '0123'),
  -- 0123 also re-bodies place_order (0016) and staff_place_order (0016) to
  -- expand a combo p_items element into real component rows,
  -- apply_order_taxes (0037) to clamp each line's discount share to the line
  -- (a ₹0 line could previously land a negative taxable_value), and
  -- get_receipt (0010) to carry combo_group/combo_name per item -- nothing
  -- further to check-schema for any of those.
  --
  -- owner-recorded margin on a combo (0124)
  ('column',   'combos.margin',                            '0124')
  -- 0124 also re-bodies create_combo/update_combo (already registered, 0123)
  -- with an added p_margin -- nothing further to check-schema for that part.
  ,
  -- spin & win (0125)
  ('table',    'spin_wheels',                              '0125'),
  ('table',    'spin_segments',                            '0125'),
  ('table',    'spin_results',                             '0125'),
  ('function', 'save_spin_wheel',                          '0125'),
  ('function', 'get_spin_wheel',                           '0125'),
  ('function', 'spin_the_wheel',                           '0125'),
  ('function', 'find_spin_prize',                          '0125'),
  ('function', 'redeem_spin_prize',                        '0125'),
  -- 0126 recreates staff_place_order with p_spin_code; the old 13-arg
  -- signature is dropped, so exactly one overload must remain.
  ('function', 'staff_place_order',                        '0126'),
  -- 0128 — operator console user detail. The two profiles columns are what
  -- "last active" and "last device" are read from; without them the console
  -- shows "Not recorded yet" for everyone forever rather than erroring.
  ('column',   'profiles.last_seen_at',                    '0128'),
  ('column',   'profiles.last_device',                     '0128'),
  ('function', 'touch_user_activity',                      '0128'),
  ('function', 'op_list_users',                            '0128'),
  ('function', 'op_user_detail',                           '0128'),
  -- 0131 — QR token resolvers. These MUST exist before the app that calls
  -- them is deployed, and 0132's revoke must come after. If either is
  -- missing while the other is applied, QR ordering breaks for guests.
  ('function', 'resolve_table_token',                      '0131'),
  ('function', 'list_cafe_tables_with_tokens',             '0131'),
  -- 0134 — operator café sessions. active_impersonated_cafe() is load-bearing
  -- for tenant isolation: is_cafe_member() calls it on every policy check, so
  -- if it is missing the membership predicate itself fails to create.
  ('table',    'cafe_impersonations',                      '0134'),
  ('function', 'active_impersonated_cafe',                 '0134'),
  ('function', 'op_begin_cafe_session',                    '0134'),
  ('function', 'op_end_cafe_session',                      '0134'),
  ('function', 'impersonation_context',                    '0134'),
  ('function', 'op_list_cafe_sessions',                    '0134'),
  -- 0135 — operator/missing-screen access fix. all_screen_keys is new;
  -- default_role_screens and my_screen_access (already registered, 0096)
  -- are only re-bodied.
  ('function', 'all_screen_keys',                          '0135')
  -- 0136 re-bodies op_cafe_health (already registered, 0020) to fix a
  -- column-reference ambiguity -- no new object, nothing further here.
  --
  -- 0137 revokes authenticated/anon's direct-call grant on apply_order_taxes
  -- (already registered, 0016 call chain / body at 0037) -- a grant-only
  -- security fix, no new object.
  --
  -- 0138 revokes authenticated/anon's direct-call grant on
  -- resolve_coupon_discount (already registered via 0061/0078's coupon
  -- family) -- a grant-only security fix, no new object.
  --
  -- 0139 re-bodies wallet_confirm_topup (already registered, 0091) to fix a
  -- check-before-lock race, and adds a backstop unique index
  -- (wallet_transactions_topup_payment_uq) -- indexes aren't tracked by this
  -- checker; verified instead by the self-check inside 0139 itself.
  --
  -- 0140 closes menu food-cost exposure: menu_item_effective_cost (already
  -- registered, 0052) is re-bodied into a checked wrapper; the new internal
  -- computation function is registered below. Column/policy/grant changes on
  -- menu_items, menu_item_variants, menu_item_addons aren't new objects --
  -- verified instead by the self-check inside 0140 itself.
  ('function', 'menu_item_effective_cost_internal',       '0140')
  -- 0141 revokes authenticated's direct-call grant on order_outstanding
  -- (0041), order_refunded_total (0028), bill_status (0039) and
  -- build_kot_payload (0027) -- all already registered -- and moves
  -- recompute_order_payment_status (0041) from authenticated to
  -- service_role only. Grant-only security fixes, no new object.
  --
  -- 0142 re-bodies role_default_permissions (0079/0134), op_update_admin_
  -- permissions (0117), op_create_admin (0117), create_staff_invite (0073)
  -- and create_staff_member (0085) -- all already registered -- to restore
  -- dropped permission keys and close a role/permission escalation gap. No
  -- new object; verified by the self-check inside 0142 itself.
  --
  -- 0143 re-bodies resolve_coupon_discount (0061/0078), create_coupon (0061/
  -- 0078), create_reward (0064/0120/0121), redeem_reward (0064),
  -- save_spin_wheel/spin_the_wheel/redeem_spin_prize (0125/0127) and
  -- staff_place_order (0016..0126) -- all already registered -- to enforce
  -- plan entitlements server-side via cafe_has_feature(). No new object.
  --
  -- 0144 -- idempotent inventory reversal (double-restock fix).
  ('column', 'orders.stock_reversed_at', '0144'),
  -- reverse_stock_for_cancelled_order (already registered, 0060) is
  -- re-bodied only -- no new object for that part.
  --
  -- 0146 -- URGENT follow-up to 0138: drops an orphaned 4-arg overload of
  -- resolve_coupon_discount (from 0061, predating 0078's category-scoping)
  -- that survived 0138's revoke and was still granted to authenticated.
  -- No new object; verified by the self-check inside 0146 itself.
  --
  -- 0147 -- URGENT fix for a regression introduced in 0143: redeem_spin_prize
  -- referenced spin_results.redeemed_by, a column that has never existed on
  -- that table. Re-bodies redeem_spin_prize only -- no new object.
  --
  -- 0148 -- URGENT fix for a pre-existing bug (present since 0091, predating
  -- this session): wallet_confirm_topup's final UPDATE referenced
  -- payment_attempts.provider_payment_id, a column that has never existed on
  -- that table. Re-bodies wallet_confirm_topup only -- no new object.
  --
  -- 0149 -- POS redesign: wires table_sessions.guest_count through for real.
  -- Adds a 15th (p_guest_count) trailing param to staff_place_order (old
  -- 14-arg signature explicitly dropped first, per this repo's established
  -- arity-bump convention). No new tracked object -- guest_count itself has
  -- existed on table_sessions since 0012.
  --
  -- 0150 -- KOT print bridge retry/backoff. Re-bodies bridge_claim_jobs only
  -- (same (text, integer) signature) to also reclaim failed jobs under the
  -- attempt cap, and to include each job's `kind` in the response. No new
  -- tracked object.
  --
  -- 0151 -- Change-KOT versioning. New build_kot_update_payload function and
  -- cafes.kot_print_on_update column (both tracked below); re-bodies
  -- enqueue_kot_jobs only (same no-arg trigger-function signature) to use it.
  --
  -- 0152 -- KOT tickets print the cafe's own name. Re-bodies build_kot_payload,
  -- build_kot_update_payload and test_print only (all unchanged signatures).
  -- No new tracked object.
  --
  -- 0153 -- Table write-off. New write_off_session function (tracked below);
  -- re-bodies close_session only (same (uuid) signature) to also clear its
  -- session's notifications on close.
  --
  -- 0145 -- GST credit notes for refunds.
  ('table',    'credit_note_counters',                '0145'),
  ('function', 'claim_credit_note_number',             '0145'),
  ('column',   'refunds.credit_note_number',           '0145'),
  ('column',   'refunds.credit_note_issued_at',        '0145'),
  ('column',   'refunds.credit_note_taxable_value',    '0145'),
  ('column',   'refunds.credit_note_tax_amount',       '0145'),
  -- refund_order (0028..0098), get_receipt (0010..0123) and
  -- gst_invoice_report (0063/0072) are re-bodied only -- no new object for
  -- those three.
  --
  -- KOT print bridge (0150/0151).
  ('function', 'build_kot_update_payload',            '0151'),
  ('column',   'cafes.kot_print_on_update',           '0151'),
  -- Table write-off (0153).
  ('function', 'write_off_session',                   '0153'),
  --
  -- Today's Offer (0154/0155). place_order and staff_place_order are
  -- re-bodied only (unchanged signatures) -- no new tracked object for
  -- either. Same for get_recommendations (0155).
  ('column',   'menu_items.offer_price',               '0154'),
  ('column',   'menu_items.offer_days',                '0154'),
  ('function', 'cafe_current_weekday',                 '0154'),
  -- WhatsApp bill receipts (0156) -- mirrors sms_logs/enqueue_bill_sms (0010).
  ('table',    'whatsapp_logs',                        '0156'),
  ('function', 'enqueue_bill_whatsapp',                '0156'),
  -- WhatsApp order-placed message + bill re-wired to payment_status (0157).
  ('function', 'enqueue_order_placed_whatsapp',         '0157'),
  -- WhatsApp bills on Growth/Scale plans (0158). Owner-facing toggle from
  -- that migration was superseded by 0159 -- ops-only via
  -- cafe_feature_overrides, same lever as qr_ordering's kill switch.
  ('function', 'whatsapp_bills_active',                 '0159'),
  -- get_receipt: payment breakdown + customer name for the redesigned bill (0160).
  ('function', 'get_receipt',                           '0160'),
  -- Owner-controlled bill CTA link, replacing the star-rating feedback gate (0161).
  ('column',   'cafes.bill_link_url',                   '0161'),
  -- Owner-customizable bill CTA button text, e.g. "Google Review" (0162).
  ('column',   'cafes.bill_link_label',                 '0162'),
  --
  -- Phase 1 security lockdown (0163/0164/0165) -- ops-panel audit findings.
  -- 0163: cafes gets a column-level UPDATE grant replacing the blanket
  -- table grant (no new tracked object, verified by the migration's own
  -- self-check block); platform_plans/cafe_feature_overrides/operator_notes/
  -- password_reset_log RLS tightened to specific permissions (no new
  -- object); op_delete_cafe and op_update_lead_status re-bodied only
  -- (unchanged signatures).
  -- 0164: place_order re-bodied only (unchanged signature) to enforce the
  -- qr_ordering kill switch.
  ('function', 'cafe_payments_enabled',                 '0164'),
  -- 0165: service-role-only audited write path for the expiry cron and the
  -- Razorpay platform-billing webhook.
  ('function', 'system_update_cafe_billing',             '0165'),
  -- 0166: 6 unprotected premium features (crm, inventory, expenses,
  -- feedback, advanced_analytics, advanced_reports) get server-side
  -- entitlement checks. v_customer_stats, update_customer_name,
  -- record_inventory_movement, create_purchase_order, record_expense,
  -- delete_expense, feedback_summary, advanced_analytics_report,
  -- profitability_report, operations_report are all re-bodied only
  -- (unchanged signatures) -- no new tracked object for any of them.
  -- gst_invoice_report/adjustments_report are deliberately left untouched
  -- (Day Close needs them ungated); these two new wrapper RPCs are the only
  -- new objects.
  ('function', 'gst_invoice_report_premium',              '0166'),
  ('function', 'adjustments_report_premium',              '0166'),
  -- record_expense re-bodied only (unchanged signature) -- fixes a
  -- pre-existing (since 0050) missing ::payment_method cast that made every
  -- call fail. No new tracked object.
  ('table',    'expenses',                                'schema.sql / 0034'),
  -- Phase 3 (ops panel) -- 0172: Alert Centre. platform_alerts is a real
  -- persisted table (not computed-on-read), reconciled from the same 3
  -- signals op_cafe_health() computes, synced inline by op_list_alerts() on
  -- every read (no cron infra exists to sync separately). New permission
  -- pair alerts.view/alerts.manage added to role_default_permissions/
  -- op_update_admin_permissions/op_create_admin (re-bodies, already tracked
  -- above, no new row). 0173: op_list_audit_logs -- search/filter for
  -- /ops/audit-logs (action, target type, actor, date range, free text).
  ('table',    'platform_alerts',       '0172'),
  ('function', 'op_list_alerts',        '0172'),
  ('function', 'op_acknowledge_alert',  '0172'),
  ('function', 'op_resolve_alert',      '0172'),
  ('function', 'op_list_audit_logs',    '0173'),
  -- Phase 5 (real-data-only portion) -- 0177: platform-wide orders-by-source
  -- and payment-method-mix, gated on the existing subscriptions.view key (no
  -- new permission key needed). Deliberately excludes revenue/MRR/churn --
  -- platform_billing_events has 0 rows, every café's billing_status is
  -- 'none', so that would be fabricated. This is real, already-happened
  -- money only: orders placed, payments collected.
  ('function', 'op_platform_analytics', '0177'),
  -- 0178: full-audit fix -- the public, no-login kitchen display (/kds/[slug])
  -- showed zero orders because orders' RLS requires auth.uid(), which this
  -- screen never has by design. Two new SECURITY DEFINER RPCs granted to
  -- anon, scoped to exactly what a kitchen board needs.
  ('function', 'public_kds_orders',        '0178'),
  ('function', 'public_kds_advance_order', '0178')
  -- 0174: op_list_alerts re-bodied only (fixes a runtime ambiguous-column
  -- bug in the upsert, caught live -- unchanged signature, already tracked
  -- above, no new row).
  -- 0176: op_list_alerts re-bodied a second time -- 0174 qualified the
  -- SELECT list but missed the ON CONFLICT target list/predicate (structurally
  -- unqualifiable Postgres syntax), which still collided with the same
  -- OUT-parameter names. Fixed with `#variable_conflict use_column`. Caught
  -- live via authenticated RPC testing after 0174 alone still errored --
  -- unchanged signature, already tracked above, no new row.
  -- Phase 4 (RBAC completeness) -- 0175: adds sales_admin role (widens
  -- platform_admins_role_chk, not separately tracked here) and a new
  -- cafes.reset_password permission key. Re-bodies role_default_permissions,
  -- op_update_admin_permissions, op_create_admin, op_update_admin, and
  -- op_log_password_reset -- all five already tracked above, no new rows;
  -- only op_update_admin and op_log_password_reset had never been touched by
  -- a migration since 0079.
  -- Phase 2 (ops panel) -- 0168: op_cafe_health gains a trailing
  -- p_cafe_id uuid default null (old zero-arg signature dropped first, per
  -- this repo's established arity-bump convention; already tracked above at
  -- line 95). 0169: op_list_cafes gains subscription_ends_at +
  -- p_expiring_within_days (already tracked at line 93). 0170: op_list_users
  -- gains p_has_cafe (already tracked at line 519). 0171: op_get_cafe_detail's
  -- account object gains billing_status (already tracked at line 94). All
  -- four are re-bodies/signature changes of already-tracked functions -- no
  -- new tracked object for any of them.
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
