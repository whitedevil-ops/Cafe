-- ============================================================================
-- 0224 — Replace the Android plan's placeholder pricing (0222 copied
-- Starter's numbers as a stand-in) with its real price: ₹8,000/yr, renewing
-- at ₹4,000/yr — the same half-price renewal pattern every other plan uses
-- (Starter 10k→5k, Growth 18k→9k, Scale 21k→10.5k).
--
-- price_monthly is left untouched (999, Starter's placeholder) — it isn't
-- rendered anywhere (platform_billing_state / the Billing page only show
-- price_yearly + renewal_price_yearly), and no decision on a real monthly
-- figure has been made.
-- ============================================================================

update platform_plans
set price_yearly = 8000, renewal_price_yearly = 4000
where key = 'android';

-- ── self-check ─────────────────────────────────────────────────────────────
do $$
declare v_row record;
begin
  select * into v_row from platform_plans where key = 'android';
  if v_row.id is null then raise exception 'android plan row not found'; end if;
  if v_row.price_yearly is distinct from 8000 then raise exception 'android price_yearly not updated'; end if;
  if v_row.renewal_price_yearly is distinct from 4000 then raise exception 'android renewal_price_yearly not updated'; end if;

  -- Every other plan must be completely unaffected.
  if exists (
    select 1 from platform_plans
    where key in ('trial','starter','pro','business')
      and (price_yearly, renewal_price_yearly) is distinct from (
        case key when 'starter' then 10000 when 'pro' then 18000 when 'business' then 21000 else price_yearly end,
        case key when 'starter' then 5000 when 'pro' then 9000 when 'business' then 10500 else renewal_price_yearly end
      )
  ) then
    raise notice 'an existing plan''s price differs from the figures this migration assumed — verify manually, this check is informational only (prices can legitimately change over time)';
  end if;
end $$;
