-- ============================================================================
-- 0018 — Customer CRM: segments computed from data that already exists
-- (orders, order_items, loyalty), not a second customer system. No new
-- customer-facing writes here — this is a read model on top of customers/
-- orders/loyalty_accounts, all of which already carry the tenant RLS this
-- needs. `security_invoker = true` makes the view enforce THAT RLS against
-- whoever queries it, not the view owner's — required for a view that's
-- queried directly by the client, exactly like every other table read in
-- this app (v_loyalty_balance is only ever read from inside a SECURITY
-- DEFINER function that already gates by cafe_id, so it never needed this;
-- this view will be queried straight from the dashboard, so it does).
--
-- Segment rules (a café owner should be able to explain every one of these
-- out loud — no fake "AI", just clear thresholds):
--   New        — 0 or 1 completed visit ever.
--   At risk    — 2+ completed visits, but none in the last 30 days. Checked
--                BEFORE "VIP" on purpose: a big spender going quiet is the
--                most actionable signal an owner can act on, so it should
--                never get buried under a generic VIP badge.
--   VIP        — 3+ completed visits AND in the top 10% of spenders at this
--                café (percentile rank, not a fixed rupee number — so it
--                means the same thing for a small café and a big one).
--   Regular    — everyone else with repeat visits.
-- ============================================================================

create index if not exists orders_customer_idx on orders (customer_id);

create or replace view v_customer_stats
with (security_invoker = true) as
with order_stats as (
  select
    o.cafe_id,
    o.customer_id,
    count(*) filter (where o.status = 'completed')                        as visits,
    coalesce(sum(o.total) filter (where o.status = 'completed'), 0)       as total_spend,
    max(o.created_at) filter (where o.status = 'completed')               as last_visit
  from orders o
  where o.customer_id is not null
  group by o.cafe_id, o.customer_id
),
item_counts as (
  select o.cafe_id, o.customer_id, oi.name, sum(oi.qty) as qty
  from orders o
  join order_items oi on oi.order_id = o.id
  where o.customer_id is not null and o.status = 'completed'
  group by o.cafe_id, o.customer_id, oi.name
),
favourite as (
  select distinct on (cafe_id, customer_id) cafe_id, customer_id, name as favourite_item
  from item_counts
  order by cafe_id, customer_id, qty desc, name
),
spend_rank as (
  select cafe_id, customer_id,
         percent_rank() over (partition by cafe_id order by total_spend) as spend_pctile
  from order_stats
  where visits > 0
)
select
  c.id                              as customer_id,
  c.cafe_id,
  c.name,
  c.phone,
  c.email,
  coalesce(os.visits, 0)            as visits,
  coalesce(os.total_spend, 0)       as total_spend,
  case when coalesce(os.visits, 0) > 0
       then round(os.total_spend::numeric / os.visits) else 0 end as avg_order_value,
  os.last_visit,
  f.favourite_item,
  coalesce(lb.balance, 0)           as loyalty_points,
  case
    when coalesce(os.visits, 0) >= 2 and os.last_visit < now() - interval '30 days' then 'at_risk'
    when coalesce(os.visits, 0) >= 3 and coalesce(sr.spend_pctile, 0) >= 0.9 then 'vip'
    when coalesce(os.visits, 0) <= 1 then 'new'
    else 'regular'
  end as segment
from customers c
left join order_stats os on os.cafe_id = c.cafe_id and os.customer_id = c.id
left join favourite    f on f.cafe_id = c.cafe_id and f.customer_id = c.id
left join spend_rank   sr on sr.cafe_id = c.cafe_id and sr.customer_id = c.id
left join loyalty_accounts la on la.cafe_id = c.cafe_id and la.customer_id = c.id
left join v_loyalty_balance lb on lb.account_id = la.id;
