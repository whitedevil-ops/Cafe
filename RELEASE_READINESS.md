# KhaoPiyo — Release Readiness

**Date:** 2026-07-24. Inputs: `SECURITY_AUDIT.md`, `PRIVACY_COMPLIANCE_AUDIT.md`, `PRODUCT_GAP_AUDIT.md`, live production probes, `tests/integration/security-boundaries.test.ts`.

---

## Decision

# ✅ READY FOR CONTROLLED SINGLE-CAFÉ PILOT
# ⛔ NOT YET READY FOR LIMITED COMMERCIAL LAUNCH

**Why pilot-ready:** No P0. Cross-café isolation is proven intact (café A cannot read or write café B; anon cannot read any sensitive table). No secret is exposed; git history is clean. Payment secrets are encrypted and locked. The core ordering→billing→payment→GST→refund flow is coherent and server-authoritative.

**Why not commercial-ready:** One unresolved **P1 financial-integrity** issue (F-01: any café staff member can bypass the RPC layer and manipulate their own café's orders/payments via REST) and **P1 legal/privacy** gaps (placeholder policy, no grievance contact, no data-deletion path). Per the audit rule, a product is not commercial-ready while a significant P1 financial issue is open.

**Pilot conditions (must hold):**
1. The pilot café's staff accounts are the owner's own **trusted** employees (F-01 is an insider risk; the café is both actor and victim).
2. Fix **F-02** (anon `cafes` PII exposure) before onboarding — ~15-min migration, provided.
3. Publish a **basic real privacy notice + grievance contact** (not the placeholder).
4. Add a **duplicate-order guard** (double-tap/network-retry safety).
5. Disclose to the pilot café, in writing, that RBAC financial hardening (F-01) and full legal terms are in progress.

---

## Executive summary — the 17 answers

1. **P0 vulnerabilities:** none.
2. **P1 vulnerabilities:** 3 — F-01 financial tables writable by any staff role via REST; F-02 full `cafes` row exposed to anon (all cafés' owner_id/email/phone/GSTIN); F-03 legal/privacy pages are placeholders.
3. **Secrets exposed:** none — repo, bundle, and full git history clean; correct `NEXT_PUBLIC` vs server-only split.
4. **Credentials requiring rotation:** **none.** (If you ever suspect the earlier-shared `PAYMENTS_ENC_KEY` value leaked, rotate *that category* — but nothing in the repo forces it.)
5. **Cross-café isolation:** **HOLDS** — proven live; `is_cafe_member(cafe_id)` + `with check` block A↛B; anon sweep returned `[]` on every sensitive table. Only leak is F-02 (read-only business PII via the `cafes` public policy).
6. **Auth / RBAC:** Auth strong (Supabase, robust OTP, gated middleware, solid platform-admin gate). **RBAC weak** — not enforced at the DB layer for financial writes (F-01).
7. **Financial manipulation:** RPCs are correct and server-authoritative, **but bypassable** by an authenticated staff member writing tables directly (F-01). Anonymous/remote manipulation: not possible.
8. **Payment security:** Razorpay design is strong (per-café encrypted secrets, HMAC webhook verify, idempotent, server amounts, paid-only-on-webhook). **Not yet proven with a real ₹ transaction** — do one ₹1 live test per connected café.
9. **Privacy/compliance gaps:** placeholder policy, no grievance contact, no deletion/export workflow, indefinite retention, F-02 exposure, whole-customer-DB readable by any staff role.
10. **Legal pages needing work:** Privacy (real), Terms (real + lawyer), Refund/Cancellation, Data-deletion/request, Grievance/Contact. Cookie note is accurate (essential-only).
11. **Highest-value missing features:** DB-enforced RBAC/financial controls; counter thermal bill print; day-close Z-report; duplicate-order guard; customer order-status screen; customer-data erasure control.
12. **Features to SKIP:** reservations, delivery fleet, multi-outlet/central-kitchen ERP, HRMS/payroll, accounting ERP, kiosk, AI forecasting, marketing automation, chatbot.
13. **Performance/reliability risks:** no duplicate-submit guard; realtime relies on polling backstop (fine); `xlsx` ReDoS on menu import (F-06); dashboard/reports queries look indexed but should be watched at scale; backup posture undocumented.
14. **Paid infra actually required now:** none to run a pilot. **Recommended soon:** Supabase paid tier for **PITR/daily backups** (financial data with no restore path is the real operational risk), and a rate-limiter (Upstash free tier) for OTP/QR endpoints.
15. **Paid infra that can wait:** Razorpay is per-café (their cost, not yours); SMS provider only when SMS receipts are on; custom email domain; CDN — all deferrable.
16. **Manual tests YOU must perform:** (a) log in as a café owner and re-run SECURITY F-01 in DevTools to see the exposure first-hand; (b) one ₹1 real Razorpay transaction per connected café to confirm webhook→PAID; (c) print a real KOT on the café's thermal printer via the bridge; (d) place ~20 rapid orders to sanity-check load/duplicates; (e) confirm the GST invoice format with your CA (`GST_VALIDATION_REQUIRED` in the privacy report).
17. **Ready for ONE real café?** **Yes — as a controlled pilot with the 5 conditions above.** Not for open commercial sign-ups until F-01 + legal/privacy are closed.

---

## Fix sequence to reach commercial-ready

1. **F-01** (migration + app): lock financial tables to SELECT + column-scoped status updates; route all money writes through RPCs; add role gates. *(Architecture — plan provided in SECURITY_AUDIT §F-01; do NOT hot-patch.)*
2. **F-02** (migration): column-grant the anon `cafes` read. *(Provided — ~15 min.)*
3. **Legal/privacy** (F-03): real privacy notice + grievance contact + data-deletion RPC + Terms.
4. **F-04 headers** (low-risk, ready to apply) · **F-05 rate limiting** · **F-06 xlsx** migration.
5. Re-run `tests/integration/security-boundaries.test.ts` — the F-01 assertions must flip from "attack succeeds" to "attack blocked."

None of these touch production data, DNS, credentials, or payment settlement. I made **no changes** to code or production during this audit (audit-first). Say the word and I'll apply them in this order, smallest-risk first.
