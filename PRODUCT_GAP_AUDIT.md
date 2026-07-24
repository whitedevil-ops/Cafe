# KhaoPiyo — Product Audit

**Date:** 2026-07-24. Benchmarked against market expectations for Petpooja, Restroworks, GoFrugal, SlickPOS (India) and Toast/Square/Lightspeed (global), plus Swiggy/Zomato customer-UX patterns. Benchmarking only — no proprietary UI/assets copied.

**Lens for every gap:** does it help the owner control money, staff work faster, kitchen work faster, the customer order easier, or the system avoid mistakes / stay reliable? If not → SKIP.

---

## 1. What KhaoPiyo already does exceptionally well

- **One canonical data model.** An order *is* the billable unit — bills/reports/refunds/GST derive from it. No parallel "bills" table to disagree. This is cleaner than several incumbents.
- **QR ordering + counter POS + waiter tableside share one order engine** (`place_order`/`staff_place_order`) with server-authoritative pricing. Three front-ends, one truth.
- **Payment-state model** (post this session): PAID / PARTIALLY PAID / PAYMENT DUE derived from a ledger, consistent across POS/Tables/Bills/Dashboard; takeaway payment-first, dine-in running bill.
- **Real GST invoicing** with atomic FY numbering, HSN/SAC, CGST/SGST, inclusive pricing — most SMB tools bolt this on; here it's native.
- **Zero-cost operating posture** (Supabase free tier, base64/realtime instead of paid add-ons) — fits the target ₹0-overhead café.
- **Owner command centre** with live outstanding, cash-shift discrepancy, low-stock, at-risk customers — genuinely owner-value-dense.
- **Optional-everything architecture:** cafés run without online payments, without cash-shift, without KOT printing, without SMS. Good for a first café.

---

## 2. Capability matrix vs market expectation

| Capability | KhaoPiyo | Market expectation | Owner | Staff | Complexity | Priority |
|---|---|---|---|---|---|---|
| QR ordering | ✅ strong | table | ●●● | ●● | — | have |
| Counter POS | ✅ | full | ●●● | ●●● | — | have |
| Dine-in / tables / sessions | ✅ | full | ●● | ●●● | — | have |
| Takeaway | ✅ | full | ●● | ●●● | — | have |
| KDS | ✅ | full | ● | ●●● | — | have |
| KOT print | ✅ (bridge) | thermal | ● | ●●● | med | have |
| Billing / GST | ✅ | full | ●●● | ●● | — | have |
| Payments (counter) | ✅ | full | ●●● | ●●● | — | have |
| Payments (online) | ✅ per-café Razorpay | gateway | ●●● | ● | med | have (verify live) |
| Refunds | ✅ RPC | full | ●●● | ●● | — | have |
| Customer history / CRM | ✅ | full | ●● | ● | — | have |
| Loyalty | ⚠️ schema only | points | ●● | ● | med | **partial** |
| Menu mgmt / modifiers / sold-out | ✅ | full | ●● | ●● | — | have |
| Reports | ✅ sales/expenses/net | full | ●●● | ● | — | have |
| Expenses | ✅ | many lack it | ●●● | ● | — | have |
| Inventory / recipe / food-cost / low-stock | ✅ | premium tier | ●●● | ● | high | have (advanced) |
| Cash shift / drawer | ✅ | full | ●●● | ●● | — | have |
| RBAC | ⚠️ UI/RPC only, not DB-enforced | full | ●●● | ●● | — | **gap (SECURITY F-01)** |
| Realtime | ✅ + polling backstop | expected | ● | ●●● | — | have |
| Offline resilience | ⚠️ partial | expected | ● | ●●● | high | partial |
| Platform admin | ✅ | operator console | ●●● | — | — | have |
| Onboarding | ⚠️ basic | guided | ●● | — | med | thin |
| Digital receipts | ✅ /r/token | expected | ● | ● | — | have |
| **Printed thermal bill at counter** | ⚠️ KOT only | expected | ●● | ●●● | med | **gap** |
| **Reservations / delivery / multi-outlet** | ❌ | segment-dependent | — | — | high | **SKIP for now** |

---

## 3. Top gaps (prioritised, not feature-chased)

### Top 5 owner-value gaps
1. **DB-enforced financial controls / RBAC** — today a cashier can bypass discount caps and mark bills paid (SECURITY F-01). This is the #1 *owner-trust* gap. **Before pilot.**
2. **Customer-facing printed thermal bill** at the counter (KOT print exists; a customer bill/receipt print does not). Indian counters expect a printed bill. **Before/early pilot.**
3. **Daily "Z-report" / day-close summary** — one owner-facing end-of-day sheet (sales, tax collected, by-method, discounts, refunds, cash variance). Pieces exist; the single close-out view doesn't. **After pilot.**
4. **Loyalty actually wired** (schema exists, no earn/redeem UI). Only if the café asks. **If asked.**
5. **Data-deletion / customer-erasure control** (privacy + owner asks "remove this number"). **Before pilot (compliance).**

### Top 5 staff-efficiency gaps
1. **Double-submit / duplicate-order guard** on Place Order (network retry safety). **Before pilot.**
2. **Bill reprint & "email/SMS this bill"** one-tap from Bills/Tables (SMS exists on completion; on-demand resend is thin).
3. **Faster item search / keypad** for large menus at counter (works; could add barcode/short-code).
4. **Shift handover clarity** — who's on, open drawer, unsettled tables at a glance.
5. **KDS bump-bar / station routing** polish (stations exist for KOT; KDS station filter is basic).

### Top 5 customer-UX gaps
1. **Order status after placing** (customer sees "placed" but not live "preparing → ready"). Swiggy/Zomato set this expectation. **After pilot.**
2. **Clear pay-now vs pay-at-counter choice** — solid now; add a visible running total + tip option.
3. **Allergen / veg-nonveg marks & item images consistency** (veg mark exists; ensure every item).
4. **Language/₹ formatting** for regional cafés (Hindi toggle) — *if asked*.
5. **"Call waiter / request bill" feedback** — confirm the tap registered (reduce repeat taps / spam).

---

## 4. What competitors have that KhaoPiyo should NOT build (now)

Reservations, delivery-fleet/rider management, multi-outlet/central-kitchen ERP, full accounting/HRMS/payroll, self-service kiosk hardware, supplier-procurement ERP, AI demand-forecasting, marketing automation, AI chatbot. None serve the single-café pilot's money/speed/reliability goals; each adds surface area and cost. **Revisit only on explicit customer demand.**

---

## 5. Build order

- **Before pilot:** F-01 RBAC/financial lockdown · duplicate-order guard · customer-erasure control · (nice) counter bill print.
- **After pilot:** day-close Z-report · customer order-status screen · on-demand bill resend · onboarding polish · finish offline resilience.
- **Only if asked:** loyalty earn/redeem · reservations · multi-outlet · regional language.
- **Do not build:** delivery fleet, HRMS/payroll, accounting ERP, kiosk, AI forecasting, marketing automation.
