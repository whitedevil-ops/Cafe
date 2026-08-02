# KhaoPiyo — Master Product, Codebase & Production Audit

**Date:** 2026-08-02
**Method:** Full read-only static audit — every claim below is cited to a real file/line and cross-checked against the actual migration or route it depends on. No code was run; no button was clicked in a live browser. Where live/runtime behavior couldn't be confirmed from code alone, it's marked **Not Verified**.
**Note on staleness:** this repo already contains `SECURITY_AUDIT.md`, `PRODUCT_GAP_AUDIT.md`, `PRIVACY_COMPLIANCE_AUDIT.md`, `RELEASE_READINESS.md` — all found to be **out of date** relative to current code during this audit. Treat *this* document the same way: it is a snapshot of 2026-08-02, not a living source of truth. Re-verify before trusting it in three months.
**Scope:** 118 migrations, ~121 app pages/components, 25 API routes, 49 shared components, 23 lib modules, live pilot café (Brewora, Hisar).

---

## READ THIS FIRST — the one thing that must be fixed before onboarding any café beyond the trusted pilot

**`wallet_confirm_topup` can be called directly by any signed-in user to credit wallet balance with no payment and no ownership check.**

- `supabase/migrations/0093_wallet_cash_topup.sql:33-59` (bug originates earlier, at `0091_customer_wallet.sql:166-193`)
- The function is `SECURITY DEFINER`, revoked from `anon`, but **granted to `authenticated`**. It only checks that the `payment_attempts` row exists and isn't already confirmed — it never checks `auth.uid()` or any membership/ownership relationship to the transaction.
- **Concretely exploitable:** self-serve signup is open (`/signup` and `/get-started`), so getting an `authenticated` JWT costs nothing. As a customer, start a real wallet top-up (`wallet_start_topup`) to get a legitimate `payment_attempts.id`. Then, instead of paying via Razorpay, call `supabase.rpc('wallet_confirm_topup', {p_attempt_id, p_provider_payment_id: 'anything'})` directly against the PostgREST endpoint using any authenticated JWT. The function credits `wallet_transactions` for free — the Next.js webhook route (with its correct signature verification) is never touched.
- Every other money-moving RPC in the codebase checks `is_cafe_member`/`has_cafe_role`/`auth.uid()` (`record_payment`, `refund_order`, `cancel_order`, shift RPCs, loyalty RPCs). `wallet_charge_order` (which *spends* balance) is correctly locked to internal-only callers. `wallet_confirm_topup` is the single exception, despite its own comment claiming "webhook only — service_role."
- **This is a live, production-reachable bug, not a theoretical one** — the account creation, the top-up-start call, and the confirm call are all currently exposed, working endpoints.
- Fix direction (not implemented, per your explicit "do not implement anything" instruction): revoke `authenticated`, grant `service_role` only — that already matches what the webhook route actually uses (`createServiceClient`).

Everything else in this report is genuinely secondary to this. Full detail is in the Security section below.

---

## 1. Complete Feature Inventory

Legend: ✓ Working · ⚠ Partial/gap · ✗ Missing or broken

| Category | Status | Notes |
|---|---|---|
| **Authentication** | ✓ | Login, signup (email OTP via Resend, IP-throttled), forgot/reset password all real and working. ⚠ Two parallel registration paths exist (`/signup` self-serve vs `/get-started` lead-capture) and only one is linked from marketing — confusing, not broken. |
| **Landing Website** | ✓ | Fully honest — real live Supabase metrics, one real testimonial + explicitly-labeled sample slot, 7 SEO landing pages with claims matched to shipped features, legal pages present but self-flagged "requires professional review." |
| **Onboarding** | ✓ | 3-step wizard, resumable server-side draft, plan-limit-aware, staff-invite short-circuit. No gaps found. |
| **Cafe Profile** | ✓ | Settings/GST/Payments/Integrations panels all real. ⚠ No confirm dialog before disconnecting live Razorpay. Integrations panel (Swiggy/Zomato/ONDC) is an honest, labeled stub — not a defect. |
| **Platform Admin** | ✓ | Overview, Admins, Audit Logs, Café Directory, Café Detail, Leads all fully wired with server-enforced permissions + audit logging. ⚠ Health page has no client-side permission gate (silently shows a false "all healthy" screen to an unauthorized admin instead of a 403). ⚠ Users page unbounded/unpaginated (fine today, won't scale). |
| **POS** | ✓ | Fully wired to real RPCs. ⚠ Two optimistic-update handlers (advance status, toggle reserve) don't check the write's error, so a failed update silently desyncs the UI. ⚠ Only major dashboard screen without a realtime backstop (5s poll only). |
| **QR Ordering** | ✓ | Best-audited module in the app — idempotent order placement, server-revalidated coupons, webhook-confirmed payment (never trusts its own client callback), documented fail-open kill-switch. |
| **Live Tables** | ✓ | Cancel/refund dialogs are the gold-standard pattern (reason required, loading, error). ⚠ Same optimistic-update-without-error-check bug as POS (advance, toggleReserve, acknowledgeAttention, SMS retry). |
| **Bills** | ✓/⚠ | View + real PDF/xlsx export. ⚠ Capped at 200 rows with no "load more" or truncation indicator — busy cafés over a date range can silently lose rows. |
| **GST** | ✓ | Invoice numbering is atomic/gapless per financial year; CGST/SGST computed server-side; snapshot to `order_items` at sale time. No gaps. |
| **Payments** | ✓/✗ | Razorpay flow (checkout, webhook signature verify, per-café encrypted secrets) is excellent. **✗ Wallet top-up confirmation has the critical bug above.** |
| **Kitchen (dashboard)** | ✓ | Real-time + polling, cancel/reprint/late-flagging all real. ⚠ Same optimistic-update bug as Tables. |
| **KDS (public wall screen)** | ✗ | The primary "Done" button is broken — sends a status value (`'done'`) the API doesn't accept, and the underlying station display is unauthenticated by design so the call also 401s. Ticket reappears within ~2s of being marked done. See Bugs list, Critical. |
| **KOT Printing** | ✓ | Real print-bridge token issue/revoke, test print RPC, confirm dialogs on destructive actions. |
| **CRM / Customers** | ✓/⚠ | Fully wired, real RPCs. ⚠ **Unbounded query** — fetches every customer a café has ever had with no `.limit()`, filters client-side. Will degrade as café tenure grows. |
| **Inventory** | ✓/⚠ | Movement-ledger pattern (no edit/delete of items, only logged movements) — likely deliberate for audit-trail integrity, but no way to correct a data-entry mistake without a new movement. |
| **Recipes** | ✓/⚠ | Real costing (`menu_item_costs`, per-variant `cost_delta`). ⚠ Real bug: removing an ingredient optimistically clears it from the UI before the delete resolves, with no rollback on failure — item can appear removed when it wasn't. |
| **Purchases** | ✓/⚠ | Supplier + PO lifecycle fully wired. ⚠ Uses native `window.prompt()` for cancel-reason instead of the app's own confirm-dialog component — inconsistent, renders poorly on mobile. |
| **Reports** | ✓ | 9 report types (sales, items, GST, payments/outstanding, adjustments, operations, day-close, profitability, recommendations), all server-authoritative, all aggregate live from source tables (no drift-prone summary tables), correctly capped where row counts could be unbounded. |
| **Expenses** | ✓/⚠ | Real RPCs. ⚠ Same optimistic-remove-without-rollback bug as Recipes. |
| **Loyalty** | ✓ | Append-only ledger (no mutable balance column), redemption race condition already fixed with an advisory lock (migration 0071). |
| **Coupons** | ✓ | Server-side validation of every rule (expiry, min order, usage caps, per-customer caps); redemption race condition already fixed (migration 0071). |
| **Feedback** | ✓ | View-only, real summary RPC, no issues. |
| **Notifications** | ✓/⚠ | In-app realtime bell (`notification-bell.tsx`) works. **No dedicated notification-preferences settings panel found** — grep across `app/dashboard/settings` for "notification" returned zero matches. |
| **Settings** | ✓/⚠ | Staff, Cash Management, KOT Printing, Role Access all real. ⚠ "Cancel invite" has no confirm dialog (low risk, but inconsistent with the pattern used one row above it for removing a staff member). |
| **RBAC** | ✓ | Café-level roles (owner/manager/cashier/waiter/kitchen) and platform-level granular permissions both enforced **server-side inside RPCs**, not just hidden in the UI — verified by reading the actual `has_cafe_role`/`has_platform_permission` checks, not just trusting a UI gate. |
| **Plans / Entitlements** | ✓/⚠ | `hasFeature()` gates reports/loyalty/coupons/seats by plan tier correctly. ⚠ Documented fail-open: an RPC error during the entitlement check defaults to "allowed," trading strict gating for availability. |
| **Subscriptions / Billing** | ✓ | Real Razorpay Subscriptions flow, webhook-confirmed activation (explicitly does not trust its own client-side success callback). |
| **Security** | ✗ | See the critical wallet bug above; otherwise unusually disciplined (see Security section). |
| **API Integrations** | ✓/✗ | Razorpay (payments + subscriptions), Resend (email), SMS provider (present but customer OTP login is currently disabled by product decision — see below). ✗ No delivery-aggregator (Swiggy/Zomato/ONDC), no WhatsApp, no accounting export — all honestly absent, not broken. |
| **Realtime** | ✓/⚠ | Genuinely used (not decorative) for Tables, Kitchen, Notifications, always paired with a polling backstop. ⚠ POS itself doesn't use it despite being the busiest screen. |
| **Analytics** | ✓ | Real `advanced_analytics_report` RPC, view-only. |
| **Mobile UX** | ⚠ | Not deeply audited in this pass (see Not Verified); dashboard is responsive per earlier session verification, but no dedicated native/PWA experience for staff phones. |
| **PWA** | ✗ | **Confirmed absent** — no `manifest.json`, no service worker, no PWA config in `next.config.ts`, no manifest `<link>` in `app/layout.tsx`. Only "install" story today is the Windows/Mac desktop Tauri app, which doesn't help a waiter's Android phone. |

---

## 2. Broken Features

1. **KDS public "Done" button (`/kds/[slug]`) does not work.** See Critical Bug #1 below — this is a real, verified, reproducible break in a screen explicitly meant to run unattended in a working kitchen.
2. **Wallet top-up confirmation trust boundary is broken**, not just insecure — a top-up can be "confirmed" without ever being paid, meaning the wallet balance itself cannot be trusted as a ledger of real money received once this path is reachable. Covered in full under Security.
3. Everything else audited was found **functionally working** (see Feature Inventory ✓ entries and the per-agent detail preserved in sections 3, 5, 6, 9 below) — this is a smaller "broken" list than the audit brief anticipated, which is itself a finding: the codebase is unusually far from "half-finished" for its size.

## 3. Broken Buttons / Broken Actions

Static-code-verified (handler exists but does the wrong thing, or a confirm step doesn't actually gate the action). No live click-through was performed — see methodology note at the very end.

| # | Location | Problem | Impact |
|---|---|---|---|
| 1 | `app/kds/[slug]/kds-client.tsx:77-84` + `app/api/orders/[id]/route.ts:18` | "Done" sends `status:'done'`, which isn't in the API's allowed enum (`placed/accepted/preparing/ready/served/completed/cancelled`) → always 400. Route also requires auth (`401`) on a screen designed to run with no login. | Ticket never actually clears; reappears in ~2s. Core interaction of an unattended kitchen screen is dead. |
| 2 | `app/dashboard/reservations/reservations-client.tsx:112-122` | `window.prompt()` for a cancel/no-show reason — clicking the browser's own **Cancel** button on the prompt does **not** abort the action; code proceeds regardless (`?? undefined` swallows the null). | A misclick or a genuine "never mind" on the prompt still cancels/no-shows the reservation, with no undo. |
| 3 | `app/dashboard/tables/floor-client.tsx:339-345` (`advance`) | Optimistically updates order status in the UI, then writes to `orders` **without checking the returned error**. | A failed status transition (e.g. "Start preparing") shows success in the UI while the DB never recorded it, with zero feedback until the next poll silently reverts it. |
| 4 | `app/dashboard/kitchen/kitchen-client.tsx:151-158` (`advance`) | Identical pattern to #3, on the kitchen board. | Same silent desync, on the screen where it matters most (an order the kitchen thinks moved on but didn't). |
| 5 | `app/dashboard/tables/floor-client.tsx:476-480` (`toggleReserve`) | Same no-error-check pattern. | Reserve flag can silently fail to save. |
| 6 | `app/dashboard/tables/floor-client.tsx:512-516` (`retrySms`) | `fetch()` result's `res.ok` is never checked. | A failed SMS retry looks identical to a successful one. |
| 7 | `app/dashboard/recipes/recipes-client.tsx:84-89` (`removeIngredient`) | Optimistically removes the row from the UI before the delete resolves; on failure only a toast fires, **no rollback**. | Ingredient can appear gone from a recipe when the DB delete actually failed — silently wrong food cost from then on. |
| 8 | `app/dashboard/expenses/expenses-client.tsx:85-90` (`removeExpense`) | Same optimistic-remove-without-rollback pattern. | Expense can appear deleted when it wasn't — silently wrong P&L. |
| 9 | `app/dashboard/pos/pos-client.tsx:522-527` (`discardHeld`) / `510-520` (`resumeHeld`) | Delete's returned error is never checked. | A held order can fail to discard/resume with no feedback. |
| 10 | `app/dashboard/profile/payments-panel.tsx:89-98` (`disconnect`) | No confirm dialog before disabling the café's live Razorpay connection. | One misclick turns off online payments for the café with no "are you sure." |
| 11 | `app/dashboard/purchases/purchases-client.tsx:204-211` (`cancelOrder`) | Native `window.prompt()` instead of the app's own confirm-dialog component. | Inconsistent, renders poorly on mobile Safari/Chrome; functions but looks unfinished next to every other confirm flow in the app. |
| 12 | `app/dashboard/settings/settings-client.tsx:124-128` (`removeInvite`) | No confirm dialog before deleting a pending staff invite, one row below `removeMember` which correctly has one. | Low risk (unclaimed invite only) but inconsistent. |
| 13 | `app/dashboard/menu/menu-manager.tsx:398-407` (`bulkSetAvailable`) | On partial failure, only the **first** error is surfaced; items that individually failed remain optimistically marked as changed with no per-item indicator. | The success-count toast is accurate, but a specific failed item isn't distinguishable in the UI. |
| 14 | `app/platform-admin/cafes/[id]/cafe-detail-client.tsx:180` (`extendSubscription`) | No `submitting`/disabled state while in flight (every sibling action on this page has one). | A fast double-click could double-submit a subscription extension. |

## 4. UX Problems

- **Native `window.prompt`/`window.alert` used in 2 places** (Purchases cancel-reason, Reservations cancel/no-show reason) where every other destructive action in the app uses the shared `ConfirmProvider` dialog — visually and behaviorally inconsistent, and the Reservations instance is also functionally broken (item #2 above).
- **Silent-failure pattern repeated 6× across 5 different modules** (POS, Tables ×3, Kitchen, Recipes, Expenses) — optimistic UI updates with no error check and no rollback. This is a single fixable pattern, not 6 unrelated bugs, and worth fixing as one pass.
- **Reports pages use plain "Loading…" text, not skeleton loaders** — consistent across all 9 report pages so not jarring, but a step behind the polish level of the rest of the redesigned app.
- **Platform Admin Health page can show a false "all healthy" screen** to an admin who lacks permission, instead of a clear access-denied message (data is genuinely blocked server-side, so this is a UX/trust issue, not a security hole).
- **Two parallel registration entry points** (`/signup` self-serve vs `/get-started` lead capture) with only one linked from marketing — works, but is confusing product surface area to maintain and explain.
- **Customer OTP verification is currently off** — the QR customer login gate only takes name+phone with no SMS verification (explicitly reverted by migration 0089 after the SMS provider was never actually configured in production). The OTP code paths still exist in the code/DB, dormant, which is fine, but any UI copy that still implies "verified via OTP" would be misleading — worth a copy check.
- **Bills, Customers, and platform-admin Café Directory all lack real pagination** for what will eventually be large lists — today's data volume masks this, but it's a UX cliff waiting to be hit as the pilot café's history grows or as more cafés onboard.

## 5. Security Issues

Ordered by severity. Full methodology: RLS across all 118 migrations, all 4 Supabase client entry points, all 25 API routes, secrets/env exposure, `lib/crypto.ts`, entitlements/RBAC (café + platform level), classic vuln patterns (SQLi, XSS, CSRF, IDOR).

### CRITICAL
- **`wallet_confirm_topup` — free wallet credit, no payment verification, no ownership check.** Full detail at the top of this document. `supabase/migrations/0093_wallet_cash_topup.sql:33-59`.

### HIGH
- None found beyond the above that weren't already mitigated in current code.

### MEDIUM
- **`xlsx@0.18.5` parses untrusted uploaded files.** `lib/menu-workbook.ts:87`, `package.json:26`. This is the last version SheetJS published to npm; known prototype-pollution/ReDoS fixes were never backported there. Since self-serve signup means anyone can become a café owner and upload a menu-import file into a shared multi-tenant Next.js process, a crafted file could degrade the process for *other* cafés, not just the uploader. This is the same issue the repo's own (stale) `SECURITY_AUDIT.md` flagged as F-06 — independently re-confirmed still open here.
- **`customers` table is readable by every staff role, including kitchen/waiter.** `supabase/migrations/0071_p0_hardening.sql:44-46` correctly locked down writes (`revoke insert, update, delete`) but left `SELECT` gated only by `is_cafe_member(cafe_id)`, with no role restriction — any staff member can read the full customer list (name, phone) for their café. Doesn't cross tenant boundaries. Read-side half of the repo's own stale F-08.

### LOW
- **`hasFeature()` fails open on RPC error** (`lib/entitlements.ts:20-24`) — documented, deliberate availability-over-strict-gating tradeoff. Flagging because any input that reliably errors the underlying RPC would bypass plan gating for that one request. Not verified whether such an input currently exists.
- **Billing-expiry cron endpoint has no auth if `CRON_SECRET` is unset** (`app/api/platform-billing/check-expiry/route.ts:80-85`) — an intentional local-dev fallback per `.env.example`; if unset in the actual production environment, it's an open trigger for café-suspension emails. **Not Verified**: this audit had no access to check the live Vercel env config.

### INFORMATIONAL
- `GET /api/orders` has no auth check of its own and relies entirely on RLS (which today correctly returns `[]` for anon reads since migration 0050). Zero defense-in-depth on this specific route — flagged so that any future RLS change on `orders` doesn't silently re-open a cross-café data leak through this endpoint with nothing else standing in the way.

### What was checked and found genuinely solid
- Admin/service-role Supabase client (`utils/supabase/admin.ts`) never appears in a `'use client'` file — all 10 call sites verified server-only.
- All 25 API routes individually checked for session + resource-ownership verification (not just "is logged in") — consistently present.
- Razorpay webhook signature verification uses `crypto.timingSafeEqual` correctly (`lib/razorpay.ts:27-36`); per-café webhook secrets resolved server-side by URL token, not spoofable payload fields.
- `lib/crypto.ts`: AES-256-GCM, random 12-byte IV per encryption, auth-tag verified. Encryption key confirmed server-only, never `NEXT_PUBLIC_*`, not committed.
- Full grep of `NEXT_PUBLIC_*` usage across the repo — only anon key, app URL, and search-console verification strings are exposed; no secret leaks.
- All 9 `dangerouslySetInnerHTML` usages are static/env-derived JSON-LD, never user input.
- Platform-admin RBAC (migration 0079) enforces self-role-change and super-admin-escalation guards, and every mutating `op_*` RPC writes to `platform_audit_logs`.
- Customer OTP issuance is rate-limited (3/15min per phone + 8/15min per-IP), bcrypt-hashed, 5-attempt cap, `service_role`-only.
- Security headers present in `next.config.ts:40-53` (CSP deliberately deferred per its own comment; X-Frame-Options/HSTS/nosniff/Referrer-Policy/Permissions-Policy all set).
- No raw string-concatenated SQL found anywhere. Storage bucket (`menu-images`) correctly folder-scoped by café membership.
- The exact class of bug the audit brief asked us to "verify, don't assume is fixed" — coupon-redemption race, loyalty double-spend race, stale-recipe inventory-reversal bug — were **all three found to have been real bugs that were already identified and fixed together** in `supabase/migrations/0071_p0_hardening.sql` (2026-07-25), and the fixes were independently re-verified present in the current function bodies, not just claimed in a comment.

## 6. Database Issues

- **Missing composite index on `payments`.** Only index is `(cafe_id, order_id)` from the base schema; `shift_summary()` (`0029_cash_shifts.sql`) filters by `cafe_id + method + created_at range` on every shift open and on the live dashboard — this scan gets more expensive as `payments` grows. Recommend `(cafe_id, method, created_at)`.
- **`check-schema.sql` is current** through migration 0118 — explicitly verified, not stale, well-maintained. (Worth noting since the repo's *other* audit docs were found stale — this one specifically was not.)
- **All money columns are `integer` (rupees), never float**, consistently, across all 118 migrations — a deliberate, correctly-executed design choice.
- **No `bills` table exists at all, by design** — a "bill" is derived at read time from `orders` + `payments` + `refunds`, avoiding a second source of financial truth. Loyalty and wallet balances are likewise always `sum()` over an append-only ledger, never a stored/denormalized balance column that could drift or be corrupted by a bad write.
- **Hard café deletion cascades away all financial history**, including GST invoice numbers — a deliberate choice (an Archive-only path was considered and rejected by the founder per migration 0102's own comment), gated to `super_admin` only, with a summary-only audit snapshot (`cafe_deletions`) that keeps row *counts* but not the underlying financial detail. Worth confirming this still matches current risk tolerance now that real cafés' GST history is at stake, and worth wiring up `list_cafe_deletions()` in the admin UI — the write path exists but nothing displays it (see Missing Features).
- **`customers` list query is fully unbounded** — see Performance section; this is a database-shaped issue as much as an app one.
- **`op_list_cafes`** runs 6 correlated subqueries per café row with no `LIMIT` — will get slower as café count grows on the platform.
- Naming is fully consistent (snake_case, plural tables, `<parent>_id` FK convention) across all 118 migrations, no exceptions found. Tenant isolation via `cafe_id` + RLS is applied consistently; child/line-item tables (`order_items`, `refund_items`, `purchase_order_items`) deliberately scope through their parent join rather than duplicating `cafe_id`, applied uniformly.
- **Not Verified**: whether `SMS_PROVIDER` is actually configured in the live production environment (determines whether the dormant customer-OTP path is truly inert); real-world row counts/query latency for `payments` (index gap is correctness-neutral, purely a scale question).

## 7. Performance Issues

- **`app/dashboard/customers` — fully unbounded query.** No `.limit()`/`.range()` at all; every customer a café has ever had is fetched and filtered client-side. Will get slower every month for an established café.
- **`op_list_cafes` (platform-admin café directory)** — no `LIMIT`, 6 correlated subqueries per row. Platform's most scale-sensitive query as café count grows.
- **Bills is capped at 200 rows with no real pagination** — busy date ranges can silently drop rows beyond 200.
- **POS (`pos-client.tsx`) is the one major dashboard screen without a realtime backstop** — polls tables every 5s and stats every 20s while Tables/Kitchen/Notifications all supplement their polling with Supabase Realtime.
- **KDS public screen polls every 2s**, the tightest interval in the app, with no realtime — plausibly justified (unauthenticated slug-based access, not a Supabase session) but undocumented as a deliberate choice, unlike the realtime hook's own rationale comment elsewhere.
- **Menu cache has a documented 30-second staleness window** with no tag-based invalidation — a menu edit (price change, sold-out toggle) can take up to 30s to reach customers scanning a QR code. Deliberate, documented tradeoff; worth re-confirming it still matches product expectations.
- **Minor N+1 patterns** in `app/api/platform-billing/check-expiry/route.ts:60-73` (serial per-café email + update inside a loop) and two menu-import flows (`bulk-import-panel.tsx:295-303`, `menu-manager.tsx:146-148`, serial per-category RPC calls) — all bounded by admin/setup-flow volume, not order volume, so low urgency but real.
- No genuine N+1 found in the actual money/order hot paths (reports, bills, POS) — those consistently batch or push aggregation into a single RPC.

## 8. Code Quality Issues

- **4 components exceed ~950 lines**: `floor-client.tsx` (1018), `menu-manager.tsx` (1007), `pos-client.tsx` (971), `menu-client.tsx` (949) — all core operational screens, all strong candidates for splitting into subcomponents.
- **Order-creation logic is genuinely duplicated between `place_order` (QR) and `staff_place_order` (POS)** — two separate PL/pgSQL functions with a line-for-line-duplicated item/variant/addon validation loop, manually kept in sync by copy-paste across 8+ migrations (the project's own migration comments acknowledge this explicitly as a deliberate tradeoff to avoid introducing *new* differences, not as an oversight). Real drift risk for future changes.
- **`lib/upsell.ts` is dead code** — zero import references anywhere in the repo; its logic was reimplemented inline in `menu-client.tsx` instead. Safe to delete or reconcile.
- Two Supabase client entry points in two differently-named top-level folders (`utils/supabase/*` for the real app, `lib/supabase.ts` for an 11-line offline/demo-mode fallback) — functionally fine, cosmetically inconsistent naming.
- Essentially no TODO/FIXME/commented-out-code accumulation found — the codebase reads as actively maintained, not as accumulating deferred work.
- **Not Verified**: dead-code findings are grep-based (filename-string heuristic), not a real TS-aware unused-export analysis — could miss dynamic imports or false-negative on name collisions.

## 9. Business Logic / Money-Flow Verification (Phase 9)

The core test applied to every item: is the number authoritative in a server-side Postgres function, or does the client compute it and the server just store it?

| Area | Verdict | Where |
|---|---|---|
| GST/tax calculation | **Server-authoritative** | `apply_order_taxes`, `0037_gst_configuration.sql:84` |
| Order totals (POS + QR) | **Server-authoritative** | `place_order`/`staff_place_order`, current bodies `0106_per_variant_cost.sql`; client sends only item IDs + quantities |
| Discounts (POS) | **Server-authoritative**, role-capped (owner 100%/manager 15%/other 5%) | `staff_place_order`, `0061_coupons.sql:513-530` |
| Coupons | **Server-authoritative**; redemption race condition found-and-fixed | `resolve_coupon_discount` (`0061`), advisory lock added in `0071_p0_hardening.sql` |
| Payments (Razorpay) | **Server-authoritative**; webhook-only status transition | `lib/razorpay.ts`, `recompute_order_payment_status` (`0041`) |
| Wallet top-up | **Broken — see Critical bug** | `wallet_confirm_topup`, `0093` |
| Refunds | **Server-authoritative**, capped to remaining balance, role-capped approval | `refund_order`, `0098_refund_to_wallet.sql:30` |
| Inventory deduction/reversal | **Server-authoritative**; stale-snapshot bug found-and-fixed | ledger-replay fix in `0071_p0_hardening.sql:581-663` |
| Recipe costing | **Server-authoritative** | `menu_item_costs` (`0036`), `menu_item_effective_cost` (`0106`) |
| Loyalty points | **Server-authoritative**, append-only ledger; double-spend race found-and-fixed | advisory lock added in `0071_p0_hardening.sql:76-128` |
| Reports (3 of 9 read in full, rest inferred from consistent pattern) | **Server-authoritative** | `sales_report`, `gst_invoice_report`, `adjustments_report` — no cached/materialized summary table exists anywhere that could drift |

**The headline finding here**: migration `0071_p0_hardening.sql` (2026-07-25) is where three of the exact vulnerability classes this audit was asked to check for (coupon race, loyalty double-spend, stale inventory reversal) were found and fixed together, described in its own header as coming from a prior full-repo audit. Every one of those fixes was independently re-verified present in the current code, not just trusted from a comment. The wallet bug is the one place that pass didn't reach.

---

## 10. Restaurant Owner Feedback (Phase 10 — playing the role of a busy café owner)

**What would frustrate me:**
- During dinner rush, the kitchen tablet's "Done" button doesn't actually work — tickets keep reappearing. I'd notice this on day one and it would erode trust fast, because it's the single most-used button on that screen.
- I edit a recipe (swap an ingredient) and the UI shows it removed, but if the save silently failed I'd have no way of knowing until my food-cost numbers look wrong days later.
- I'd want to correct a customer's phone number typo in Inventory or fix a one-off data-entry mistake, and there's no edit path — only new movements/ledger entries, which is safer but slower for quick fixes.
- I'd ask "can my customers order via WhatsApp?" and "can I list on Swiggy/Zomato from the same system?" almost immediately — both are honestly absent today, not fake-promised, which I'd actually respect, but I'd still want a roadmap answer.
- If my internet drops mid-rush, I don't know whether my POS can still take orders (this wasn't verified in this audit) — for a São busy café, offline resilience at the counter is not optional.
- I'd want a mobile app for my waiters' phones, not just a responsive website — there's no PWA/install prompt today.

**What would make me switch to Petpooja:** offline POS resilience, native mobile apps, hardware/printer bundling, and aggregator integrations — all things Petpooja has built out over years that KhaoPiyo hasn't reached yet.

**What would make me recommend KhaoPiyo:** the pricing is transparent and low, the reports are genuinely comprehensive (9 real report types, not a single overwhelming dashboard), the GST invoicing is correct without me thinking about it, and — notably — the marketing site didn't lie to me with fake reviews or made-up stats, which is rare enough in this category that it would actually build trust rather than erode it.

## 11. Competitor Gap Analysis (Phase 11)

**Where KhaoPiyo is better:**
- Genuinely modern stack with real Supabase Realtime (not just polling dressed up), verified server-authoritative money handling end-to-end, and a disciplined ledger-based architecture (loyalty, wallet, bills-as-derived-view) that avoids the "two sources of truth drift out of sync" failure mode common in older POS systems.
- Honest marketing — real metrics, real testimonial, explicitly-labeled placeholders. Most competitors in this exact price tier lean on invented "10,000+ restaurants" style numbers.
- Reports depth (9 distinct report types including adjustments and operations reports) is unusually thorough for the price point.

**Where KhaoPiyo is behind:**
- No native mobile apps (Petpooja/Toast/Square all have full staff-facing apps).
- No delivery-aggregator integration (Swiggy/Zomato/ONDC) — table stakes for most Indian restaurants today.
- No WhatsApp ordering/marketing — very high-value in the Indian market specifically, and a gap competitors like Petpooja/DotPe have already filled.
- No accounting-software export (Tally is near-universal among Indian small-business owners).
- Offline POS resilience is unverified/likely absent — a real risk in India's less-reliable connectivity contexts.
- No hardware/printer-bundling ecosystem.

**What MUST be added:** offline-resilient order-taking at the counter (even a minimal local queue-and-sync), WhatsApp order notifications, and a Tally/accounting export — these three close the largest, most India-specific gaps.

**What should NEVER be added:** the kind of settings sprawl and feature bloat that makes established competitors feel cluttered. The homepage's own tagline — "one system, not five tabs" — is a real, currently-true differentiator; each new integration should be evaluated against whether it dilutes that.

## 12. Missing Features (Prioritized)

**P0 — blocks safe scaling beyond the trusted pilot**
- Fix `wallet_confirm_topup` (see Critical). This isn't a "missing feature," it's the one item that must land before any second café touches the wallet feature.

**P1 — high value, contained scope**
- Fix the KDS "Done" button (real, verified break in a core kitchen interaction).
- Pagination for Customers, Bills, and platform-admin Café Directory.
- Wire up `list_cafe_deletions()` in the platform-admin UI — the audit-trail data is already being captured server-side and currently goes nowhere.
- A minimal PWA manifest + install prompt for the dashboard, so staff can add it to their phone home screen (much lower cost than a native app, addresses the "mobile app" expectation partially).
- Fix the 6 silent-optimistic-update bugs as one consolidated pass (see UX Problems).

**P2 — meaningful for growth, larger scope**
- WhatsApp order-status notifications (customer-facing, high perceived value in India).
- Tally/accounting export from Reports.
- A real edit path for Inventory items (not just movements) for correcting mistakes.
- Consolidate `place_order`/`staff_place_order` shared validation logic to remove the copy-paste drift risk.

**P3 — worth doing eventually, not urgent**
- Delivery-aggregator (Swiggy/Zomato/ONDC) integration.
- Offline-resilient POS order queue.
- Native mobile app (only after PWA proves the demand is real).

## 13. Top 25 Bugs (consolidated tracker)

| # | Severity | Location | Problem | Impact | Suggested Fix |
|---|---|---|---|---|---|
| 1 | **Critical** | `supabase/migrations/0093_wallet_cash_topup.sql:33-59` | `wallet_confirm_topup` granted to `authenticated`, no ownership/payment check | Free wallet credit, exploitable today | Revoke `authenticated`, grant `service_role` only |
| 2 | **Critical** | `app/kds/[slug]/kds-client.tsx:77-84`, `app/api/orders/[id]/route.ts:18` | "Done" status value not in API's allowed enum + route requires auth on a no-login screen | Core kitchen-display action doesn't work; ticket reappears in ~2s | Add `'done'`→`'completed'` mapping or accept it in the enum; make the route's auth model match the documented no-login design |
| 3 | High | `app/dashboard/reservations/reservations-client.tsx:112-122` | `window.prompt()` cancel doesn't actually cancel the action | Misclick permanently changes reservation status with no undo | Replace with the app's real confirm dialog |
| 4 | High | `app/dashboard/tables/floor-client.tsx:339-345` | `advance()` doesn't check the update's error | Silent UI/DB desync on order status | Check error, rollback UI + toast on failure |
| 5 | High | `app/dashboard/kitchen/kitchen-client.tsx:151-158` | Same pattern, on the kitchen board | Same silent desync, higher-stakes screen | Same fix |
| 6 | Medium | `app/dashboard/tables/floor-client.tsx:476-480` | `toggleReserve()` no error check | Reserve flag can silently fail to save | Same fix |
| 7 | Medium | `app/dashboard/recipes/recipes-client.tsx:84-89` | `removeIngredient()` optimistic remove, no rollback on failure | Ingredient can appear gone when it isn't; silently wrong food cost | Roll back on error |
| 8 | Medium | `app/dashboard/expenses/expenses-client.tsx:85-90` | `removeExpense()` same pattern | Silently wrong P&L | Roll back on error |
| 9 | Medium | `app/dashboard/pos/pos-client.tsx:522-527`, `510-520` | Held-order discard/resume don't check delete error | Held order can fail to discard/resume silently | Check error, surface toast |
| 10 | Medium | `app/dashboard/tables/floor-client.tsx:512-516` | `retrySms()` doesn't check `res.ok` | Failed SMS retry looks successful | Check response status |
| 11 | Medium | `app/dashboard/profile/payments-panel.tsx:89-98` | No confirm before disconnecting live Razorpay | One misclick disables online payments | Add confirm dialog |
| 12 | Medium | `supabase/migrations/0071_p0_hardening.sql:44-46` | `customers` table SELECT readable by every staff role | Kitchen/waiter can read full customer PII list | Restrict SELECT to owner/manager, or add a narrower view for other roles |
| 13 | Medium | `lib/menu-workbook.ts:87`, `package.json:26` | `xlsx@0.18.5` has unpatched known CVEs, parses untrusted uploads | Crafted upload could degrade the shared process for other tenants | Migrate to a maintained fork or sandbox the parse |
| 14 | Low | `app/dashboard/purchases/purchases-client.tsx:204-211` | `window.prompt()` instead of app confirm dialog | Inconsistent, poor mobile rendering | Replace with `ConfirmProvider` |
| 15 | Low | `app/dashboard/settings/settings-client.tsx:124-128` | No confirm before removing a pending staff invite | Low-risk but inconsistent | Add confirm dialog |
| 16 | Low | `app/dashboard/menu/menu-manager.tsx:398-407` | Bulk-availability partial failure only shows first error | Failed item not individually distinguishable | Surface per-item error state |
| 17 | Low | `app/platform-admin/cafes/[id]/cafe-detail-client.tsx:180` | `extendSubscription` has no in-flight disabled state | Possible double-submit on fast double-click | Add `submitting` guard like sibling actions |
| 18 | Low | `app/platform-admin/health/page.tsx:19` | No client-side permission gate; RPC failure defaults to empty→"all healthy" | Unauthorized admin sees false-positive health screen | Add explicit `NotAuthorized` gate like sibling pages |
| 19 | Low | `app/(auth)/forgot-password/page.tsx:21-23` | Send-failure error isn't checked; always shows "sent" | A real outage is invisible to the user | Distinguish outage from anti-enumeration case (carefully, without breaking the anti-enumeration intent) |
| 20 | Low | `app/dashboard/customers/page.tsx:40-44` | No `.limit()`/`.range()` on customer query | Unbounded growth, will slow down over time | Add pagination |
| 21 | Low | `supabase/migrations/0079_multi_admin_permissions.sql:246-271` (`op_list_cafes`) | No `LIMIT`, 6 correlated subqueries per row | Platform's most scale-sensitive query | Add pagination, consider pre-aggregated counts |
| 22 | Low | `app/dashboard/bills/bills-client.tsx:116-123` | Fixed 200-row cap, no real pagination or truncation indicator | Busy date ranges can silently lose rows | Add offset-based paging or a truncation flag like the report RPCs already use |
| 23 | Low | `app/api/platform-billing/check-expiry/route.ts:60-73` | Serial per-café email + DB update inside a loop | Slow if the expiring-soon window is ever large | Batch with `Promise.all` / bulk update |
| 24 | Low | `app/dashboard/menu/bulk-import-panel.tsx:295-303`, `menu-manager.tsx:146-148` | Serial per-category RPC calls in a loop | Slower menu-import/pairing flow than necessary | Batch into a single RPC call |
| 25 | Info | `lib/upsell.ts` | Dead file, zero import references anywhere | Maintenance noise | Delete or reconcile with the inline reimplementation in `menu-client.tsx` |

## 14. Top 50 Improvements (polish + structural, deduped and prioritized)

**Trust & correctness (do first)**
1. Fix `wallet_confirm_topup` grant.
2. Fix KDS "Done" button.
3. Fix the reservations `window.prompt` non-cancelling bug.
4. Fix the 6 silent-optimistic-update-without-rollback sites as one pass (items 4-10 in the bug tracker).
5. Restrict `customers` table SELECT by role, or add a narrower staff-facing view.
6. Migrate off unpatched `xlsx@0.18.5` for untrusted-file parsing.

**Scale readiness**
7. Paginate Customers.
8. Paginate/limit `op_list_cafes`.
9. Real pagination (not just a bigger cap) for Bills.
10. Add the missing `(cafe_id, method, created_at)` index on `payments`.
11. Batch the two menu-import N+1 loops.
12. Batch the `check-expiry` cron's per-café loop.

**Consistency & polish**
13. Replace both remaining `window.prompt()` usages with the app's real confirm dialog.
14. Add confirm dialog to Razorpay disconnect.
15. Add confirm dialog to Settings' "cancel invite."
16. Add an in-flight disabled state to `extendSubscription`.
17. Add a client-side `NotAuthorized` gate to the platform-admin Health page.
18. Give Reports pages skeleton loaders instead of plain "Loading…" text, matching the rest of the app's polish level.
19. Surface per-item error state on bulk menu-availability failures.
20. Consolidate the Purchases and Reservations reason-prompt UX into one shared pattern.

**Structural / code health**
21. Split `floor-client.tsx` (1018 lines) into subcomponents.
22. Split `menu-manager.tsx` (1007 lines) into subcomponents.
23. Split `pos-client.tsx` (971 lines) into subcomponents.
24. Split `menu-client.tsx` (949 lines) into subcomponents.
25. Extract the shared item/variant/addon validation loop out of `place_order`/`staff_place_order` into one SQL helper both call, to remove the copy-paste drift risk.
26. Delete `lib/upsell.ts` or reconcile it with the inline logic in `menu-client.tsx`.
27. Rename/relocate `lib/supabase.ts` to make its "offline/demo-mode only" purpose clearer next to `utils/supabase/*`.
28. Wire `list_cafe_deletions()` into the platform-admin UI so the audit trail that's already being captured is actually visible.
29. Add realtime backstop to `pos-client.tsx` to match the pattern already used on Tables/Kitchen.
30. Document the KDS 2s-poll-no-realtime and QR-flow-poll-no-realtime choices explicitly (they're plausibly correct, just currently undocumented, unlike the realtime hook's own rationale comment).

**Product surface**
31. Add a PWA manifest + service worker so staff can install the dashboard to their home screen.
32. Add WhatsApp order-status notifications for customers.
33. Add a Tally/accounting export from Reports.
34. Add an edit path for Inventory items, not just movements.
35. Clarify the dual registration paths (`/signup` vs `/get-started`) — either fully retire self-serve `/signup` or intentionally re-link it.
36. Add a notification-preferences panel to Settings (currently no dedicated UI exists for this).
37. Investigate and document (or build) offline resilience for the POS counter flow.
38. Re-confirm the 30-second menu-cache staleness window still matches current product expectations as the pilot café's volume grows.
39. Verify `CONTACT_EMAIL`/`GRIEVANCE_EMAIL` mailboxes referenced in the legal pages are real and monitored before wider launch.
40. Get the Privacy Policy and Terms of Service through actual legal review — both are explicitly self-flagged in code comments as not finalized.

**Smaller items**
41. Distinguish a real send-failure from the intentional anti-enumeration "sent" message on forgot-password, without breaking the anti-enumeration property.
42. Add a truncation indicator to Bills matching the pattern already used in the two capped reports.
43. Confirm whether `SMS_PROVIDER` is configured in production; if not, either configure it or remove the now-dormant OTP UI copy that implies it's active.
44. Confirm `CRON_SECRET` is actually set in the production environment.
45. Add per-row loading indicators to platform-admin café-detail's feature-toggle actions (currently only the bulk action shows one).
46. Reconsider Recipes' "remove ingredient" lacking any confirm dialog, given the app's confirm-everywhere pattern for deletes elsewhere.
47. Consider a lightweight edit affordance for held orders beyond discard/resume.
48. Consider surfacing the platform's own café-deletion policy (hard delete, no export-first) to café owners explicitly, given it now applies to real GST history.
49. Consider a maintenance pass specifically targeted at the "silent optimistic update" pattern as a reusable hook/wrapper, so future features don't reintroduce it.
50. Once the wallet bug is fixed, add a regression test for it specifically (mirroring the existing test coverage this project already built for the loyalty race-condition fix), so this class of bug can't silently return.

## 15. Overall Ratings (brutally honest, out of 10)

| Area | Score | Why |
|---|---|---|
| Landing Website | 8/10 | Genuinely honest content, real metrics, just-shipped premium redesign; docked for no PWA and unverified installer functionality |
| Authentication | 7.5/10 | Solid end-to-end flow; docked for the confusing dual-registration-path surface area |
| Platform Admin | 8.5/10 | Best-audited module in the app — server-enforced permissions everywhere, real audit logging; docked slightly for the Health page gap |
| POS | 7/10 | Fully functional; docked for the silent-update bugs and missing realtime backstop on the busiest screen |
| QR Ordering | 8.5/10 | The most thoroughly correct module found — idempotent, server-revalidated, honest fail-open documentation |
| Kitchen (dashboard + public KDS combined) | 5/10 | Dashboard Kitchen module is strong; the public KDS screen's broken core action drags the combined score down hard |
| Bills | 7.5/10 | Solid, real export; docked for the pagination gap |
| Reports | 8.5/10 | Genuinely comprehensive, all server-authoritative, correctly capped |
| CRM / Customers | 7/10 | Fully functional; docked for the unbounded query |
| Inventory | 7/10 | Solid ledger discipline; docked for lacking a correction/edit path |
| Purchases | 7/10 | Solid; docked for the native-prompt inconsistency |
| Recipes | 6.5/10 | Solid costing logic; docked for the real rollback bug |
| Payments | 5/10 | Razorpay path is excellent; the wallet top-up critical bug caps this hard regardless of everything else |
| Security | 6/10 | Unusually disciplined architecture and a strong track record of self-caught fixes (0071), but one live critical bug is disqualifying for a security score by definition |
| Performance | 7/10 | No crisis found; several concrete, fixable scale cliffs identified (customers, op_list_cafes, payments index) |
| Scalability | 7/10 | Same evidence — architecture is fundamentally sound (integer money, ledgers, RLS), specific query patterns need attention before high volume |
| UI | 8/10 | Consistent design system, just-redesigned landing page, real polish; minor native-dialog inconsistencies |
| UX | 6.5/10 | Strong overall (confirm dialogs, loading/error states mostly present), pulled down by the concentrated cluster of silent-failure bugs and 2 confirm-flow gaps |
| Database | 8.5/10 | Extremely well-designed schema discipline (money typing, ledger pattern, no second-truth tables, current schema docs, consistent naming); narrow indexing gaps only |
| Code Quality | 7/10 | Clean, low dead-code, consistent patterns; a few oversized files and one acknowledged duplication risk |
| **Overall Product** | 7/10 | Unusually complete and disciplined for its size, genuinely live with a real pilot café, let down by one critical live bug and a concentrated cluster of easily-fixable UX bugs |
| **Commercial Readiness** | 5.5/10 (would be ~8/10 immediately after the wallet fix + legal review) | Cannot responsibly onboard cafés beyond the trusted pilot while the wallet exploit is live; legal docs are explicitly self-flagged as not finalized |

---

## 16. Prioritized Implementation Roadmap (highest ROI → lowest)

1. **Fix `wallet_confirm_topup` grant** — single-line-scale fix, closes the one blocking issue for safe scaling. Do this before anything else on this list.
2. **Fix the KDS "Done" button** — small, contained fix, restores the primary function of a screen that's meant to run unattended all day.
3. **Fix the reservations `window.prompt` non-cancelling bug** — small fix, removes a real "action happens even when I said no" trap.
4. **Sweep the 6 silent-optimistic-update sites in one pass** — same fix pattern repeated across POS/Tables/Kitchen/Recipes/Expenses; doing them together is more efficient than one-off patches and removes a whole class of "looks like it worked, didn't" bugs at once.
5. **Restrict `customers` table SELECT by role** — contained RLS change, closes the one remaining PII over-exposure.
6. **Add pagination to Customers, Bills, and `op_list_cafes`** — all three are cheap, well-understood fixes (the report RPCs already show the exact pattern to copy) that head off a scaling cliff before it's hit in production.
7. **Replace the two remaining `window.prompt()` usages + add the two missing confirm dialogs** (Razorpay disconnect, invite removal) — small, consistent UX pass.
8. **Migrate off `xlsx@0.18.5`** for untrusted uploads, or sandbox the parse — medium effort, closes a real (if narrower) shared-tenant risk.
9. **Add the `payments` composite index** — trivial migration, prevents a future slow-query problem while it's still cheap to fix.
10. **Get Privacy Policy/Terms of Service through actual legal review**, and confirm the grievance/contact mailboxes are real and monitored — not code work, but a real launch blocker for anything beyond the current trusted pilot.
11. **Ship a PWA manifest** — moderate effort, directly addresses the single most likely "why doesn't this feel like a real app" objection from a restaurant owner evaluating it against Petpooja/Toast.
12. **Split the 4 oversized components** and **consolidate the duplicated order-validation logic** — larger refactors, lower urgency than anything above, but the duplication item in particular reduces real future drift risk the longer it's deferred.
13. **WhatsApp notifications + Tally export** — highest-leverage genuinely new features for the Indian market specifically, but appropriately last since everything above this line is either a live risk or a cheap fix, and these are net-new scope.

---

## Methodology / limitations (read before acting on this report)

- This audit was performed by 6 parallel research passes over the actual codebase and migrations, each independently reading and cross-citing real files — not a single pass, and not a summary of the repo's own (previously found stale) audit docs.
- **No live browser click-through was performed** in this pass — "does this button work" was verified by confirming the handler exists, calls a real endpoint/RPC that exists, and that endpoint's logic does what the button claims. This is a legitimate and in most respects stronger form of verification than clicking through a UI (it catches wrong-status-enum bugs like the KDS one that a shallow click-through might miss if the optimistic UI update masked the failure), but it cannot catch pure rendering/CSS/visual bugs, and it did not exercise real concurrent-user race conditions live (though several were verified fixed at the SQL level, which is the correct place to verify them).
- Every finding is cited to a specific file and, where possible, a line number, as of 2026-08-02. Items explicitly marked **Not Verified** were identified but could not be confirmed from static code alone (mostly: live production environment variables, and a handful of RPC bodies not read line-by-line where a consistent pattern across sibling functions made full re-reading low-value).
- This document will go stale exactly like the repo's other audit docs did. Re-run a pass like this periodically, not just once.
