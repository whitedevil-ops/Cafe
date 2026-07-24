# KhaoPiyo — Security Audit

**Date:** 2026-07-24 · **Target:** khaopiyo.ventron.in · **Method:** source + schema review + **live black-box probes against production** using the public (publishable) key. Multi-tenant, Next.js 16 / Supabase Postgres + RLS + SECURITY DEFINER RPC.

> This file consolidates the Attack Report, RLS Matrix, and Security Scorecard. Privacy/legal is in `PRIVACY_COMPLIANCE_AUDIT.md`; product in `PRODUCT_GAP_AUDIT.md`; the launch decision in `RELEASE_READINESS.md`. Automated regression tests: `tests/integration/security-boundaries.test.ts`.

No claim of "100% secure" is made. These are evidence-backed findings and residual risks.

---

## 0. Executive result

- **P0 (block launch):** 0 found. No secret exposed, no remote/anonymous financial manipulation, **cross-café isolation holds** (proven live).
- **P1 (fix before a real paying café):** 3 — (F-01) financial tables writable by any staff role via REST; (F-02) full `cafes` row exposed to anonymous internet; (F-03) legal/privacy pages are placeholders.
- **P2:** 5 · **P3:** 3.
- **Credentials requiring rotation:** **none** — repo and full git history are clean of secrets.

---

## 1. What was tested LIVE (not just read)

| Probe | Result |
|---|---|
| Anon read of 29 sensitive tables | All return `[]` **except `cafes`** (see F-02). `cafe_members` blocked (401), `cafe_payment_secrets` `[]` ✓ |
| Anon read of `cafe_payment_secrets` (encrypted Razorpay keys) | `[]` — RLS with zero policies holds ✓ |
| `staff_place_order` / `record_payment` / `record_session_payment` / `outstanding_summary` as anon | `42501 permission denied` — locked to `authenticated` ✓ |
| Razorpay connect endpoint without auth | `401` (after env configured) — encryption gate + auth both enforced ✓ |
| Platform-admin webhook (old) | `410` — superseded path neutralised ✓ |
| Whole-platform café enumeration (anon) | **Succeeds** — all cafés + owner_id/email/phone/gstin readable (F-02) |

---

## 2. Attack Report (findings)

### F-01 — Financial & business tables are fully writable by any café member via REST — **P1**
**Component:** RLS policies on `orders`, `order_items`, `payments`, `customers`, `loyalty_accounts`, `loyalty_transactions`, `coupons`, `coupon_redemptions`, `inventory_items`, `inventory_transactions`, `expenses` (schema.sql:470–481) — all `for all using (is_cafe_member(cafe_id)) with check (is_cafe_member(cafe_id))`.

**Attack scenario:** A café's own cashier/waiter/kitchen user (any role) opens DevTools, takes their Supabase JWT, and calls PostgREST directly:
- `PATCH /rest/v1/orders?id=eq.<id>` → `{"payment_status":"paid","total":1}` — mark any bill paid, zero the total.
- `POST /rest/v1/payments` → `{"amount":1,...}` or `DELETE /rest/v1/payments` — fabricate or **erase the ledger**.
- `PATCH /rest/v1/order_items` → `{"price":0}` — under-charge.
- Freely mutate `expenses`, `inventory`, `loyalty`, `coupons`.

**Impact:** The entire "server-authoritative, ledger-is-truth, RPC-validated" model (record_payment overpay checks, role-based discount caps of owner 100% / manager 15% / cashier 5%, immutable audited payments) is the *intended* path but **not enforced** — it is fully bypassable by any authenticated staff member. RBAC for financial actions does not exist at the database layer; every role has owner-level write power within its own café.

**Evidence:** `app/dashboard/kitchen/kitchen-client.tsx:147,157` already does exactly this from the app (`payments.insert(...)` then `orders.update({payment_status:'paid'})`). Contrast with `refunds`/`cash_shifts` (0028/0029) which correctly use **`member read` (SELECT-only)** + SECURITY DEFINER RPCs — the safe pattern exists in the codebase; it just wasn't applied to the financial core.

**Boundary that HOLDS:** `with check (is_cafe_member(cafe_id))` blocks café A from writing café B rows — **tenant isolation is intact** (this is why F-01 is P1, not P0).

**Fix (architecture-level — DO NOT hot-patch; needs a migration + app changes):**
1. Restrict `orders` to `SELECT` + a **column-scoped `UPDATE`** for operational columns only (`status`, `done_at`) via `GRANT UPDATE (status, done_at) ON orders TO authenticated` and a policy; revoke row-wide update. All money columns (`total, subtotal, tax, payment_status, payment_method, discount`) become writable only by SECURITY DEFINER RPCs.
2. `payments`, `order_items`, `expenses`, `loyalty_*`, `coupons`, `inventory_*` → `member read` (SELECT); route all writes through RPCs (record_payment already exists; add thin RPCs for expenses/inventory/loyalty as needed — inventory already has `record_inventory_movement`).
3. Rewrite `kitchen-client.markPaid` to call `record_payment` (like `floor-client` already does).
4. Add role checks inside the write RPCs where a role gate is intended.

**Regression test:** `security-boundaries.test.ts` → "a member JWT cannot directly UPDATE orders.payment_status" and "cannot INSERT into payments" (currently these would PASS the attack = FAIL the test until fixed).

---

### F-02 — Full `cafes` row exposed to anonymous users; whole platform enumerable — **P1**
**Component:** `create policy "public brand" on cafes for select to anon using (true)` (schema.sql:430).

**Attack scenario:** `GET https://<proj>.supabase.co/rest/v1/cafes?select=*` with the public key returns **every café** on the platform with `owner_id` (auth user UUID), `email`, `phone`, `gstin`, `razorpay_account_id`, `razorpay_status`, `subscription_ends_at`, `status`. Content-Range confirms full enumeration.

**Impact:** Anonymous disclosure of (a) your entire customer list (every café), (b) business PII — owner contact email/phone, GSTIN, (c) competitive/operational intel — who's subscribed, whose payments are configured. Under DPDP this is personal/business data exposed without basis. **Not** a secret leak: `razorpay_key_id` is a public key by design, and the Razorpay *secret* + webhook secret live in `cafe_payment_secrets` which is correctly locked.

**Why the policy exists:** the public QR menu (`/t/[token]`) needs a handful of café fields (name, logo, address, dine_in/takeaway, accept_* flags, tax display, `razorpay_status`).

**Fix (provide as migration for approval — touches the public data contract):** RLS can't restrict columns, so use column-level grants:
```sql
revoke select on cafes from anon;
grant select (id, slug, name, description, logo_url, address, city, state, pincode,
              dine_in, takeaway, accept_cash, accept_upi_counter, accept_card_counter,
              accept_pay_counter, online_payments_enabled, razorpay_status,
              tax_percent, service_charge, gst_registered, tax_inclusive, timezone, status)
  on cafes to anon;
```
Then confirm `/t/[token]/page.tsx` selects only granted columns. (GSTIN legitimately appears on GST invoices — but those render via the `get_receipt` SECURITY DEFINER function, not the anon `cafes` read, so GSTIN does not need anon column access.)

**Regression test:** "anon cannot read cafes.owner_id / cafes.email".

---

### F-03 — Legal & privacy pages are placeholders — **P1 (compliance)**
**Component:** `app/legal/[doc]/page.tsx` — privacy/terms/cookies all render *"Placeholder document. Final legal text must be reviewed…"*. No refund/cancellation policy, no data-deletion/grievance page. Detail in `PRIVACY_COMPLIANCE_AUDIT.md`.

**Impact:** Collecting customer phone/name/order history with no published privacy notice or grievance contact is a DPDP gap and a trust problem for the café. **Fix:** publish a real privacy policy + terms + refund policy + grievance contact (drafts + guidance in the privacy report; must be reviewed by counsel).

---

### P2 findings
- **F-04 — No security headers.** `next.config.ts` has no `headers()` → no CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy. Dashboard is clickjackable; no MIME-sniff protection. **Low-risk fix available** (conservative header set, no strict CSP) — proposed below.
- **F-05 — No IP/global rate limiting.** OTP has a solid per-phone DB limit (3 / 15 min, bcrypt-hashed, 10-min expiry — `0023`), but `/api/customer/request-otp`, login, and the anon QR RPCs (`place_order`, `call_waiter`, `request_bill`) have no IP/global throttle → SMS cost-exhaustion via rotating numbers, order/waiter-call spam. Add Vercel/Upstash rate-limiting or per-table cooldowns in the RPCs.
- **F-06 — `xlsx` (SheetJS) 4 high-severity vulns, no npm fix** (Prototype Pollution + ReDoS). Surface: owner/manager importing a crafted menu spreadsheet. Migrate to the vendored `https://cdn.sheetjs.com` build or replace with `exceljs`, and hard-cap upload size/parse time.
- **F-07 — CSV/XLSX formula injection (verify).** Menu export (`lib/menu-workbook.ts`) — confirm cells beginning `= + - @` are prefixed with `'`; menu item names/notes are user-controlled and land in exports opened in Excel.
- **F-08 — `customers` (full CRM incl. phone/name/spend) readable by every role.** Kitchen/waiter don't need the customer database (data minimization / RBAC). Lower priority; part of the F-01 remediation.

### P3 findings
- **F-09** — Reset-password route returns the owner's email in its 200 body (only to an authenticated platform admin — informational).
- **F-10** — No automated secret-scanning or `npm audit` gate in CI.
- **F-11** — Error surfaces: confirm production error boundaries never render stack traces / SQL (dashboard `error.tsx` shows a message; spot-check API 500s).

---

## 3. RLS matrix (business tables)

| Table | RLS | Anon | Member SELECT | Member WRITE | Tenant check | Risk |
|---|---|---|---|---|---|---|
| cafes | ✓ | **read (all cols)** | own+member | owner/manager update | id | **F-02** |
| cafe_members | ✓ | blocked | self/member | — | via fn | OK |
| cafe_payment_secrets | ✓ | blocked (0 policy) | none | RPC only | — | **OK (locked)** |
| profiles | ✓ | blocked | self/platform | self | id | OK |
| menu_items/categories/variants/addons | ✓ | read (public menu) | member all | member | cafe_id | OK (public menu intended) |
| cafe_tables | ✓ | read (by token) | member | member | cafe_id | OK |
| orders | ✓ | blocked | member | **member all** | cafe_id | **F-01** |
| order_items | ✓ | blocked | member | **member all** | via order | **F-01** |
| payments | ✓ | blocked | member | **member all** | cafe_id | **F-01** |
| customers | ✓ | blocked | member | **member all** | cafe_id | F-01/F-08 |
| loyalty_*, coupons*, inventory_*, expenses | ✓ | blocked | member | **member all** | cafe_id | **F-01** |
| refunds, refund_items | ✓ | blocked | **read only** | RPC only | cafe_id | **OK (good pattern)** |
| cash_shifts, cash_movements | ✓ | blocked | **read only** | RPC only | cafe_id | **OK** |
| table_sessions, notifications, held_orders | ✓ | blocked | member all | member | cafe_id | OK (operational) |
| platform_admins | ✓ | blocked | admin only | none (SQL only) | — | **OK (anti-self-promo)** |
| audit_logs | ✓ | blocked | member | append | cafe_id | OK |

---

## 4. What is genuinely strong (evidence)

- **Tenant isolation:** `is_cafe_member(cafe_id)` on every policy; `with check` blocks cross-café writes; anon sweep proved every sensitive table returns `[]`. Café A cannot reach Café B.
- **SECURITY DEFINER hygiene:** 112/113 functions set `search_path` inline (search-path injection mitigated). No dynamic SQL / string-built queries seen; RPC args are typed and parameterised.
- **Server-authoritative pricing:** `place_order` / `staff_place_order` look up every price, variant, add-on, tax and total from the DB — client-sent amounts are never trusted. Discount caps enforced by role *inside* the RPC. (The gap is F-01: staff can bypass the RPC, not that the RPC is wrong.)
- **Payments immutability where it counts:** refunds & cash are SELECT-only + RPC-gated; over-refund prevented by `refund_order`.
- **Razorpay:** per-café secrets AES-256-GCM encrypted at rest, never in `NEXT_PUBLIC`; webhook HMAC signature verified over raw body; idempotent `(provider, provider_payment_id)`; amounts server-computed; payment marked paid **only** on verified webhook — never on a UI callback.
- **OTP:** bcrypt-hashed, in-DB generation, SMS-only delivery, rate-limited, expiring.
- **Secrets:** clean repo, clean git history, correct `NEXT_PUBLIC` vs server-only split, service-role client server-only.
- **Storage:** uploads café-scoped by path (`is_cafe_member(folder[1]::uuid)`); only bucket is public menu images (appropriate); MIME + size limits set.
- **Receipt tokens:** UUID `receipt_token`, resolved via `get_receipt` SECURITY DEFINER which masks phone (`******1234`) — not enumerable, minimal exposure.

---

## 5. Security Scorecard (0–10, no inflation)

| Domain | Score | Basis |
|---|---:|---|
| Secrets | 9 | Clean source + history; correct env split; −1 no CI secret-scan |
| Authentication | 8 | Supabase Auth, strong OTP, standard reset, middleware gate; −2 no login IP rate-limit config |
| Authorization / RBAC | **4** | Platform-admin gate solid; but F-01: no DB-level role enforcement for financial writes |
| Tenant Isolation | 8 | Proven café A↛B; −2 for F-02 cross-café PII disclosure |
| Database / RLS | 5 | Good hygiene + isolation; −F-01 member-all on financial core, −F-02 |
| Financial Security | **4** | RPCs correct but bypassable via REST (F-01) |
| Payment Security | 7 | Strong Razorpay design; −unproven with a real live transaction |
| API Security | 7 | Authz'd, admin server-only, vague errors; −no rate limiting |
| Input Security | 6 | Parameterised, React escaping; −F-06 xlsx, −F-07 formula injection unverified |
| Rate Limiting | **3** | OTP per-phone only; nothing else throttled |
| Storage | 8 | Tenant-scoped, limits set |
| Privacy | 4 | Reasonable minimisation + masking; −placeholder policy, −no deletion/export, −F-02 |
| Legal Readiness | **2** | All legal pages placeholders |
| Dependency Security | 6 | Lean (8 deps); −xlsx high-sev, no fix |
| Operational Reliability | 6 | Realtime+polling backstop, idempotent webhook, atomic invoice numbering; −no double-submit guard, −backup posture undocumented |
| Backup / Recovery | 3 | Depends on Supabase plan; PITR not on free tier; undocumented |
| Testing | 6 | 42 tests incl. crypto + live integration; +security regression tests added this audit |

**Weighted posture: solid multi-tenant foundation with one systemic financial-integrity gap (F-01) and one privacy-exposure gap (F-02) to close before real money runs through it.**

---

## 6. Proposed low-risk fix ready to apply now (F-04 headers)

`next.config.ts` → add (no strict CSP, so nothing breaks):
```ts
async headers() {
  return [{
    source: '/:path*',
    headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    ],
  }]
}
```
(A real CSP needs a nonce pass over inline styles/scripts — deferred to avoid breaking the app.)
