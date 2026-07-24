-- ============================================================================
-- VERIFY-SECURITY — proves the F-01 / F-02 lockdown is actually in force.
-- Read-only. Run in the Supabase SQL editor AFTER migrations 0049 + 0050.
-- Every row must read PASS. A FAIL names exactly what is still open.
--
-- This is the evidence for the cashier attacks (ATTACK 2-6): if the
-- `authenticated` role holds no INSERT/UPDATE/DELETE privilege on a financial
-- table, then no JWT of any café role can perform that write through PostgREST
-- — regardless of what the UI does.
-- ============================================================================

with protected(t) as (values
  ('orders'), ('order_items'), ('payments'), ('expenses'),
  ('inventory_items'), ('inventory_transactions'),
  ('loyalty_accounts'), ('loyalty_transactions'),
  ('coupons'), ('coupon_redemptions'),
  ('refunds'), ('refund_items'), ('cash_shifts'), ('cash_movements')
),

-- 1. No table-level write privilege for anon/authenticated on financial tables.
write_grants as (
  select g.table_name, g.grantee, g.privilege_type
  from information_schema.role_table_grants g
  join protected p on p.t = g.table_name
  where g.table_schema = 'public'
    and g.grantee in ('anon', 'authenticated')
    and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
),
check_writes as (
  select
    'F-01 no direct writes: ' || p.t as check_name,
    case when exists (select 1 from write_grants w where w.table_name = p.t)
         then 'FAIL' else 'PASS' end as status,
    coalesce((select string_agg(w.grantee || ':' || w.privilege_type, ', ')
              from write_grants w where w.table_name = p.t), 'no write grants') as detail
  from protected p
),

-- 2. orders may keep ONLY column-level UPDATE on status/done_at (KDS/floor).
order_cols as (
  select string_agg(c.column_name, ',' order by c.column_name) as cols
  from information_schema.column_privileges c
  where c.table_schema = 'public' and c.table_name = 'orders'
    and c.grantee = 'authenticated' and c.privilege_type = 'UPDATE'
),
check_order_cols as (
  select 'F-01 orders update limited to status/done_at' as check_name,
         case when coalesce((select cols from order_cols), '') = 'done_at,status'
              then 'PASS' else 'FAIL' end as status,
         coalesce((select cols from order_cols), '(none)') as detail
),

-- 3. No "member all" (full CRUD) policy survives on a financial table.
check_policies as (
  select 'F-01 no member-all policy: ' || p.t as check_name,
         case when exists (
           select 1 from pg_policies pol
           where pol.schemaname = 'public' and pol.tablename = p.t
             and pol.cmd = 'ALL' and pol.roles::text not like '%service_role%'
         ) then 'FAIL' else 'PASS' end as status,
         coalesce((select string_agg(pol.policyname || '(' || pol.cmd || ')', ', ')
                   from pg_policies pol
                   where pol.schemaname = 'public' and pol.tablename = p.t), '(none)') as detail
  from protected p
),

-- 4. anon must NOT hold table-wide SELECT on cafes, only the public columns.
cafes_anon_table as (
  select count(*) as n from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'cafes'
    and grantee = 'anon' and privilege_type = 'SELECT'
),
cafes_anon_cols as (
  select string_agg(column_name, ',' order by column_name) as cols
  from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'cafes'
    and grantee = 'anon' and privilege_type = 'SELECT'
),
check_cafes as (
  select 'F-02 anon has no table-wide SELECT on cafes' as check_name,
         case when (select n from cafes_anon_table) = 0 then 'PASS' else 'FAIL' end as status,
         'table-level SELECT grants: ' || (select n from cafes_anon_table)::text as detail
  union all
  select 'F-02 anon cafes columns are the public set only',
         case when coalesce((select cols from cafes_anon_cols), '') =
                   'accept_pay_counter,id,logo_url,name,online_payments_enabled,razorpay_status,slug,upsell_threshold'
              then 'PASS' else 'FAIL' end,
         coalesce((select cols from cafes_anon_cols), '(none)')
  union all
  -- The columns that caused the leak must be absent from the anon grant.
  select 'F-02 owner_id/email/phone/gstin not readable by anon',
         case when exists (
           select 1 from information_schema.column_privileges
           where table_schema='public' and table_name='cafes' and grantee='anon'
             and privilege_type='SELECT'
             and column_name in ('owner_id','email','phone','gstin',
                                 'razorpay_account_id','subscription_ends_at')
         ) then 'FAIL' else 'PASS' end,
         'sensitive columns withheld from anon'
),

-- 5. RLS must still be enabled on every protected table.
check_rls as (
  select 'RLS enabled: ' || p.t as check_name,
         case when (select c.relrowsecurity from pg_class c
                    join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname='public' and c.relname = p.t) then 'PASS' else 'FAIL' end,
         'row level security' as detail
  from protected p
)

select * from check_writes
union all select * from check_order_cols
union all select * from check_policies
union all select * from check_cafes
union all select * from check_rls
order by status desc, check_name;
