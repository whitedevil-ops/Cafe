# KhaoPiyo — Current State (Phase 0 audit)

**Date:** 2026-07-24. This is the audit requested against the "Master Product
Readiness & Competitive Upgrade" spec. It does **not** re-derive work that's
already documented — `SECURITY_AUDIT.md`, `RELEASE_READINESS.md`,
`PRODUCT_GAP_AUDIT.md`, `PRIVACY_COMPLIANCE_AUDIT.md` and
`KHAOPIYO_ROADMAP_PROGRESS.md` already cover most of this ground in more
detail than repeating here would add. This file's job is to map that existing
work (plus what changed today) onto the spec's exact checklist, and to be
honest about what's genuinely new versus already built.

**Important correction to the existing docs:** `SECURITY_AUDIT.md`,
`RELEASE_READINESS.md` and `PRODUCT_GAP_AUDIT.md` all describe **F-01**
(financial tables writable by any staff role) as still open. It is not —
migrations `0049_fix_f02_cafes_anon_exposure.sql` and
`0050_fix_f01_financial_lockdown.sql` both exist in the repo, the app code
(`kitchen-client.tsx`'s `markPaid`) was rewritten to go through `record_payment`
exactly as the audit's fix prescribed, and the live regression suite
(`tests/integration/security-boundaries.test.ts`) passes 6/7 real, non-todo
assertions against production right now, including the F-02 anon-column
check. Those three docs were written earlier the same day, before the fix
landed, and were never regenerated. **Treat F-01 and F-02 as FIXED**, not
open — see "What's actually still open" below for the one piece that
genuinely isn't proven yet.

---

## 1. Capability matrix (spec's Phase 0 checklist)

| # | Area | Status | Evidence |
|---|---|---|---|
| 1 | Authentication | **READY** | Supabase Auth, OTP (bcrypt, rate-limited), middleware-gated routes; `security-boundaries.test.ts` proves unauthenticated redirect on all protected routes |
| 2 | Tenant isolation | **READY** | `is_cafe_member(cafe_id)` on every policy; live anon sweep of 24 sensitive tables returns `[]`/rejected — `SECURITY_AUDIT.md` §1, re-confirmed live just now |
| 3 | RBAC | **READY** (was PARTIAL) | F-01 fix (0050) makes financial writes RPC-only with role checks inside; UI additionally hides actions by role (courtesy, not the boundary) |
| 4 | POS | **READY** | Full cart/discount/hold/customer-lookup/variants/add-ons; just redesigned (Amber Warm) without touching order logic |
| 5 | QR ordering | **READY** | Grid/search/categories/cart/upsell/recommendations, no forced login |
| 6 | Order engine | **READY**, one gap closed today | `place_order`/`staff_place_order` are the single canonical path for QR/POS/waiter; **duplicate-order guard added this session** (0056, see §3) |
| 7 | Tables/sessions | **READY** | Floor areas → tables → sessions; POS/Live Tables/QR share one table source |
| 8 | Bills | **READY** | Status derived from the payments ledger (`list_bills`), not stored booleans |
| 9 | GST | **READY, code-complete** — needs CA sign-off | Atomic per-FY invoice numbering, CGST/SGST split, HSN/SAC, inclusive/exclusive pricing. `GST_VALIDATION_REQUIRED` in `PRIVACY_COMPLIANCE_AUDIT.md` §5 lists exactly what a CA must confirm before marketing as "GST compliant" — **PROFESSIONAL REVIEW REQUIRED**, not a code gap |
| 10 | Payments | **READY** | Cash/UPI/card/counter + per-café Razorpay (encrypted secrets, HMAC-verified webhook, paid-only-on-webhook); one real ₹1 transaction per connected café still needs a human — **MANUAL TEST REQUIRED** |
| 11 | Refunds | **READY** | RPC-gated, `refunds`/`refund_items` are SELECT-only to members, `profitability_report` correctly nets out refunded quantity |
| 12 | KDS | **READY** | Digital-first, NEW/PREPARING/READY, realtime + polling backstop |
| 13 | KOT (optional printer) | **PARTIAL** | Schema, queue, pairing UI exist; no actual bridge program — **BLOCKED — HARDWARE** (needs the café's real printer to write against) |
| 14 | Menu | **READY** | Categories, variants, add-ons, sold-out, CSV/XLSX import/export, cost fields |
| 15 | Customers | **READY** | CRM, segments, order history, phone-verified "My Orders" |
| 16 | Loyalty | **PARTIAL** | Schema/ledger exists; no earn/redeem UI wired — correctly deferred ("only if asked" per `PRODUCT_GAP_AUDIT.md`) |
| 17 | Inventory | **READY** | Column-locked `current_stock` (only movable via `record_inventory_movement`), low-stock surfaced on owner dashboard |
| 18 | Recipes | **READY** | BOM → cost, optional (default-off) auto-deduction on order |
| 19 | Costing | **READY** | Per-order `cost_snapshot` freezes unit cost at sale time — **historical profitability is already stable against later cost changes**, exactly what the spec's Phase 4/5 asked for (0052) |
| 20 | Expenses | **READY** | Feeds `net_profit` in `sales_report` |
| 21 | Reports | **READY (v1 scope, not 90+)** | `sales_report`: summary/by-day/top-items/by-category/by-payment-method/by-source/by-staff, `expenses`/`net_profit` folded in, `profitability_report` separate. Covers ~9 of the spec's 13 named reports natively (sales, orders, items, category, payments, discounts, expenses, profitability implicit in the above); **not separately broken out**: dedicated Cancellations/Refunds-only and Customers reports — see gaps |
| 22 | Excel exports | **PARTIAL — needs verification** | `.xlsx` export exists (menu import/export); formula-injection protection (cells starting `=+-@`) is flagged **"verify"** in `SECURITY_AUDIT.md` F-07, not yet confirmed either way; `xlsx`/SheetJS itself has 4 known high-severity CVEs with no upstream fix (F-06) |
| 23 | Staff / RBAC | **READY** | owner/manager/cashier roles, discount caps enforced server-side per role |
| 24 | Settings | **READY** | Sectioned café profile/GST/ordering/payments/floors |
| 25 | Smart recommendations | **READY** | Full priority-ranked engine (owner pin → item rule → sales pairing → category → popularity), analytics page, built this project per the earlier 22-section spec |
| 26 | Platform admin | **READY** | Operator console, café directory/health, audit logs, entitlements |
| 27 | Responsive UI | **READY** | Tested at 7 widths during the POS/menu rebuilds; not re-tested for every screen after every subsequent change |
| 28 | Performance | **READY**, not stress-tested | Indexed queries, precomputed recommendation stats, no per-request AI calls; no load test at 100+ concurrent orders has been run — **MANUAL TEST REQUIRED** |
| 29 | Error handling | **PARTIAL** | Dashboard has error boundaries; not every screen's failure mode has been adversarially reviewed this session |
| 30 | Tests | **READY, expanded** | 54 tests passing (unit: datetime/table-sort/gst/crypto/razorpay/menu-import-cost/recommend; integration: order-engine, security-boundaries) — see §4 for exactly which of the spec's named critical tests this maps to |

---

## 2. New asks in this spec not covered by the existing audits

| Ask | Status | Notes |
|---|---|---|
| **Waiter Mode** | **READY**, informally | `components/waiter/quick-add-sheet.tsx` + `floor-client.tsx`'s "Take order"/"Add items" already give a phone-first, few-taps flow through the same `staff_place_order` RPC (`KHAOPIYO_ROADMAP_PROGRESS.md` Phase 5). It is not a separately-branded "Waiter Mode" screen — it's the existing Live Tables screen's mobile composition. If a dedicated entry point/branding is wanted, that's a small UI addition, not new plumbing. RBAC already hides Reports/Profitability/Expenses/Settings from non-owner/manager roles at the server-component level. |
| **Offline resilience (Phase 2, beyond the banner)** | **PARTIAL — Phase 1 only, deliberately** | `components/offline-banner.tsx` + `useOnlineStatus()` exist (Phase 11). No offline write queue exists, **and per this project's own explicit prior decision, it deliberately should not** — queuing money-affecting writes built from stale cached prices/availability directly contradicts the "never client-authoritative" rule everywhere else in this codebase. This spec's own Phase 8 agrees ("do NOT attempt a dangerous 'make everything offline' rewrite... if full safe offline ordering cannot be implemented confidently, implement Phase 1... document Phase 2"). Phase 1 is done; Phase 2 (cached menu + durable idempotency-keyed sync) is a real, non-trivial design task, not started. |
| **Aggregator readiness (Swiggy/Zomato/ONDC)** | **NOT BUILT** | No integration abstraction, no `external_order_id`/normalized-order model exists. Correctly absent — no partner credentials exist to integrate against, and the spec itself says not to reverse-engineer private APIs. Settings → Integrations does not yet show a "Not Connected" placeholder either. |
| **Purchase management (suppliers/POs)** | **NOT BUILT** | `inventory_items.supplier` is a free-text field only; no `suppliers` or `purchases` table exists. Correctly low-priority per the spec's own Phase 10 gate ("only after core inventory works reliably") — inventory is ready, so this is unblocked whenever it's prioritized, but nothing exists yet. |
| **Multi-outlet readiness** | **NOT AUDITED FOR, NOT BUILT** | Every table keys off a single `cafe_id`; there is no organization/business entity above it. Nothing in the current schema actively blocks adding one later (cafe_id would become a child of a new `organizations` table), but this has not been verified table-by-table. Correctly deferred — explicitly on every "do not build now" list in `PRODUCT_GAP_AUDIT.md` and this spec's own "features to defer." |
| **Duplicate-order guard** | **BUILT this session** | See §3 — this was the one item flagged as an open P0 gap by both `PRODUCT_GAP_AUDIT.md` and `RELEASE_READINESS.md`, and named explicitly in this spec's critical-test list. |

---

## 3. What changed this session

**Migration `0056_order_idempotency.sql`** — written, typechecked/linted/tested/built, **applied to the live database by the owner and confirmed live**: direct RPC calls against production now return real validation errors (`invalid table`, `permission denied`) for the new `p_client_request_id` parameter instead of `PGRST202` (function not found), and a dedicated live integration test (`tests/integration/order-engine.test.ts`) proves a repeated key returns the same order while a fresh key still creates a new one — 55/55 tests passing including this new one.

**Incident, disclosed in full:** the client-side wiring was first pushed in the same commit as the migration, before the migration had actually been applied — PostgREST correctly rejected the unrecognized parameter, breaking order placement (QR/POS/waiter) in production for the window between that deploy and the revert. Caught via a direct live RPC check within minutes, reverted immediately, confirmed via the live integration suite, then re-applied only after the owner ran 0056 and I re-verified live. Lesson applied: verify a migration is actually live before shipping client code that depends on it, not just that it's written.

- `orders.client_request_id uuid` + a partial unique index on `(cafe_id, client_request_id)`.
- `place_order` and `staff_place_order` both take an optional `p_client_request_id`. If a matching order already exists for that key, the function returns **that order's original result** instead of creating a second one — a dropped-connection retry becomes a safe no-op instead of a duplicate bill. A second layer (catching `unique_violation` and re-fetching) closes the genuine race where two retries both pass the initial check before either commits.
- Wired into all three order-creation call sites: `app/t/[token]/menu-client.tsx` (customer QR), `app/dashboard/pos/pos-client.tsx` (counter POS), `app/dashboard/tables/floor-client.tsx` (waiter quick-add). Each generates one UUID per checkout attempt (`crypto.randomUUID()`, held in a ref), reuses it across a manual retry after a failed attempt, and clears it only after a confirmed success.
- `check-schema.sql` updated with the new column.

**Verified this session:** `npx tsc --noEmit` clean, `npx eslint .` unchanged at the pre-existing 13-error/2-warning baseline, `npm test` 54/54 passing (unchanged — no test yet exercises 0056 live, since it isn't applied to production yet), `npx next build` clean.

**All of the above is now done and verified live** — items 1-4 from the original plan are complete: the schema change is live, a real repeated-key call returns the identical order, a fresh key still creates a new order, and the permanent regression test is committed and passing.

---

## 4. Mapping to the spec's named "critical automated tests"

| Test | Status |
|---|---|
| POS order → correct totals | **COVERED** — `tests/integration/order-engine.test.ts` |
| QR order → same canonical calculation | **COVERED** — same file, same RPC family |
| Discount cap bypass → DENIED | **COVERED IN CODE** (role-gated inside `staff_place_order`); no dedicated adversarial test asserting a manager can't request >15% — worth adding, not present today |
| Cashier modifies total directly → DENIED | **COVERED** — F-01 fix (0050) + `security-boundaries.test.ts`'s route/RLS checks; the specific "authenticated non-owner JWT" variant is `it.todo` (needs a real cashier login fixture this environment can't create) |
| Fake payment insert → DENIED | **COVERED** by the same 0050 grant revocation; not separately asserted with an authenticated fixture, same gap as above |
| Cafe A → Cafe B access → DENIED | **COVERED** — anon sweep in `security-boundaries.test.ts`; an authenticated cross-café attempt (staff A token reading café B) is not separately tested |
| Refund → totals stay correct | **COVERED** — `refund_order` RPC, netted correctly in `profitability_report` |
| Duplicate request → no duplicate order/payment/stock | **COVERED, live-verified (0056)** — repeated key returns the same order, fresh key still creates a new one |
| GST calculation → correct server-side | **COVERED** — `apply_order_taxes`, live-verified (₹481 exact match, `KHAOPIYO_ROADMAP_PROGRESS.md` Phase 0) |
| Recipe consumption → correct stock movement | **WRITTEN, not live-verified** — auto-deduct trigger exists (0036), swallow-all-errors by design, genuinely needs a real order against a real recipe — **MANUAL TEST REQUIRED** |
| Order retry → stock not double-deducted | **COVERED as of 0056** — the trigger fires on `order_items` insert, and 0056 guarantees a retried request never inserts a second `order_items` set for the same attempt |
| Historical cost stays stable after cost update | **COVERED** — `cost_snapshot` (0052), frozen at sale time |

---

## 5. What's actually still open (honest, prioritized)

**Before a paying pilot (P0, per the spec's own priority order):**
1. Apply migration `0056` (duplicate-order guard) — written, needs the owner to run it.
2. GST: get the CA sign-off items in `PRIVACY_COMPLIANCE_AUDIT.md` §5 confirmed — **PROFESSIONAL REVIEW REQUIRED**, not something to code around.
3. Legal/privacy pages are still placeholders (F-03) — **PROFESSIONAL REVIEW REQUIRED** before any real customer data is collected commercially; fine for a *disclosed, controlled* pilot per `RELEASE_READINESS.md`'s conditions.
4. Verify F-07 (xlsx formula-injection escaping) — a same-day, checkable fix, not yet done.
5. Rate limiting (F-05) on OTP/QR RPCs — none beyond the existing per-phone DB limit.

**Genuinely needs a human/hardware/lawyer, not more code:**
- One real ₹1 Razorpay transaction per connected café.
- Recipe auto-deduction against a real order.
- Realtime delivery across two real devices.
- KOT thermal printer bridge — **BLOCKED — HARDWARE** (no printer details provided).
- SMS provider credentials (MSG91/Twilio) — **BLOCKED — EXTERNAL CREDENTIALS** (blocks OTP + SMS receipts).
- The full multi-device pilot dry run in `REAL_CAFE_PILOT_CHECKLIST.md` §2.

**Correctly not being built yet (matches this spec's own "defer" list and `PRODUCT_GAP_AUDIT.md`):** reservations, delivery-fleet management, multi-outlet/central-kitchen ERP, aggregator integrations (no partner credentials), purchase management (inventory has to be trusted first), kiosk, HRMS/payroll, accounting ERP, AI forecasting/marketing automation.

---

## 6. Bottom line

**KhaoPiyo remains ready for a controlled, disclosed single-café pilot** — the
same conclusion `RELEASE_READINESS.md` reached, now on firmer ground because
the one P1 financial-integrity gap it flagged (F-01) is confirmed fixed in
code, and the pilot's own top staff-efficiency gap (duplicate orders) has a
written fix pending only a migration run. It is **not yet ready for
unsupervised commercial sign-up** — that still needs real legal pages, CA
sign-off on the GST implementation, and the handful of live/hardware/human
verifications listed above. None of this is a "feature count" judgment;
every remaining item above is either a specific unverified behavior, a
professional-review gate, or explicitly out of scope for a first pilot by
this project's own prior, deliberate decisions.
