# KhaoPiyo — Canonical Report Definitions

**Why this file exists:** the spec for Reports V2 is explicit — "Do not create
separate frontend definitions of revenue... every report must use the same
definitions." Before writing a single new report query, this file audits what
already exists and settles on ONE set of definitions every new report (and,
where practical, every existing one) must use.

## What already existed — and a real inconsistency this file resolves

Three money-reporting RPCs already existed before this work, and they used
**three different bases** for what "revenue" means:

| RPC | Base filter | What it measures |
|---|---|---|
| `sales_report.summary.revenue` (0032/0034) | `status <> 'cancelled' AND payment_status = 'paid'` | Order totals, **paid orders only** — tax-inclusive |
| `profitability_report` (0052) | `status <> 'cancelled'` (any payment status) | Net item sales **net of that line's own refunded qty**, tax-**excluded** |
| `outstanding_summary` / `list_bills` (0042/0047) | `payments.amount` directly | Actual cash received in the period, independent of when the order was placed |

None of these were "wrong" for the narrow question each was built to answer —
but a Business Overview report that pulled a number from each would show three
different, unreconciled "revenue" figures on one screen. This file fixes that
by defining one waterfall and explaining, explicitly, the one place a second
convention remains and why.

## The canonical waterfall (Reports 1, 2, 7 — the "how much did I sell" question)

All figures below are computed over **orders placed in [from, to)**, in the
café's own timezone, excluding cancelled orders — this matches the base filter
every existing report already agrees on.

1. **Gross Sales** — `Σ(order_items.price × qty)` for every line on every
   included order. This is the raw rung-up value: before discount, before
   refund, tax excluded (line `price` is already tax-exclusive throughout the
   schema).
2. **Discounts** — `Σ(orders.discount)` for included orders. Locked in at the
   order itself (role-capped, server-computed at placement) — there is no
   separate "discount event" with its own date.
3. **Refunds** — `Σ(refunds.amount)` for refunds with `status = 'completed'`
   **whose own `created_at` falls in [from, to)** — not the original order's
   date. A refund is a real cash event that can happen in a later period than
   the sale; recognizing it in the period it actually occurred (rather than
   retroactively rewriting a past period's numbers every time a refund is
   processed) matches this project's existing "a settled bill doesn't change
   after the fact" philosophy (cost snapshots, tax snapshots, GST invoice
   numbers are all locked at their own event time, not the original order's).
4. **Net Sales** = Gross Sales − Discounts − Refunds. **This is the headline
   "how much did I sell" figure.**
5. **GST / Tax** = `Σ(orders.tax)` for included orders — accrual basis (tax is
   computed by `apply_order_taxes` at placement time regardless of payment
   status, so this reflects tax on everything sold, not just what's been
   paid or invoiced yet). The dedicated GST/Tax Report (Report 6) uses a
   **different, invoice-basis** figure on purpose — see below.
6. **Collected** = `Σ(payments.amount)` for payments **recorded in [from, to)**
   — cash-basis, independent of which period the underlying order was placed
   in (a dine-in tab opened last week and paid today counts as collected
   today). This is `outstanding_summary`'s existing, correct definition,
   reused unchanged.
7. **Outstanding** = `Σ(greatest(0, order.total − paid))` for included,
   non-cancelled orders, evaluated **as of now** — also `outstanding_summary`'s
   existing definition, reused unchanged.

**Gross Sales − Discounts − Refunds = Net Sales is an identity every report
using this waterfall must satisfy.** Collected and Outstanding are
deliberately *not* part of that same identity — they answer "how much cash has
actually moved," a genuinely different question from "how much did I sell,"
and conflating the two is exactly the mistake the spec warns against ("Cash =
unpaid" reasoning). Show them side by side; never derive one from the other.

## Profitability (Report 4) — a deliberately different, narrower question

`profitability_report` (0052) nets a line's **own** refunded quantity out of
**its own order's period** (not the refund event's period). This is
intentional and stays unchanged: profitability answers "what did selling this
dish actually net the café, all-in" — a per-SKU, per-sale-cohort question,
not a per-period cash question. Contribution = Net Sales (this narrower,
per-line sense) − Estimated Direct Cost (frozen `cost_snapshot`). Changing an
ingredient's cost today never rewrites a past period's contribution — already
correct, unchanged.

**Do not use Report 4's "Net Sales" number as if it were the waterfall's Net
Sales above — they can legitimately differ** (mainly around refunds that
cross a period boundary) and both are correct for the question each answers.
Every place a report shows both must label them distinctly.

## GST / Tax Report (Report 6) — invoice basis, not accrual basis

Report 6 exists for the café's accountant to reconcile actual issued GST
invoices. It must use `orders.gst_invoice_number IS NOT NULL` (i.e., orders
that actually settled to `paid` and received a real invoice number) — never
the accrual "Tax" figure above, and never recompute an old invoice's tax at
today's rate. `cgst`/`sgst` are already frozen per invoice via `get_receipt`'s
existing logic (0031); this report reads that same stored split, it does not
recalculate it.

## Cost & Contribution terminology (unchanged, restated for completeness)

- **Estimated Direct Cost** — `Σ(cost_snapshot × net_qty)`. Never call this
  actual/audited cost; it is the owner's configured recipe/manual cost, frozen
  at sale time.
- **Gross Contribution** — Net Sales (profitability sense) − Estimated Direct
  Cost.
- **Contribution Margin** — Gross Contribution ÷ Net Sales, as a percentage.
- **Never** call Gross Contribution "Net Profit" — rent, salaries and other
  overhead are not in this number. `sales_report.summary.net_profit` (Revenue
  − Refunds − Expenses) is the closest thing to a bottom-line figure that
  exists today, and even that omits overhead beyond logged `expenses`.

## Timezone

Every "period" boundary above is computed in the café's own `timezone`
(`cafes.timezone`, default `Asia/Kolkata`), via the existing
`lib/datetime.ts` / `cafe_day_start()` helpers — never a UTC calendar day.
Every new report RPC must take the café's timezone into account the same way
`sales_report`'s `by_day` breakdown already does (`created_at at time zone
cafe_tz`), not a bare `::date` cast.

## Comparison periods

"vs previous period" means: shift `[from, to)` back by its own exact
duration — `compare_from = from − (to − from)`, `compare_to = from`. A 7-day
report compares against the preceding 7 days; a custom 23-day range compares
against the preceding 23 days. This is a mechanical, deterministic
transformation with no ambiguity, computed the same way in every report that
supports comparison.

## What every new report RPC must do

1. Take `(p_cafe_id, p_from, p_to)` and check `is_cafe_member`/role exactly
   like every existing report RPC.
2. Reuse the exact filter/waterfall above rather than re-deriving it.
3. Never recompute a historical order's tax, cost, or GST invoice figures from
   today's settings — always read the stored/snapshotted value.
4. Be `stable`, `security definer`, `search_path = public`, revoked from
   `public`/`anon`, granted to `authenticated` only — the existing pattern for
   every report function in this codebase.
