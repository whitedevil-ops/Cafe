# KhaoPiyo — Privacy, Data-Protection & Legal Audit

**Date:** 2026-07-24. Scope: personal-data handling, India DPDP posture, legal pages, GST claims. **Not legal advice** — items marked *NEEDS LEGAL REVIEW* must be confirmed with a qualified Indian data-protection lawyer / CA before commercial launch.

---

## 1. Personal-data inventory

| Data | Subject | Why collected | Stored | Who can access | Retention today | Delete/Export today |
|---|---|---|---|---|---|---|
| Phone number | Customer | Order link, SMS receipt, order history, loyalty | `customers.phone`, `orders.phone`, `customer_otp_challenges` | Café members (any role) via `member all`; masked on receipts | **Indefinite** | ❌ none |
| Name | Customer | Personalisation, CRM | `customers.name` | Café members | Indefinite | ❌ |
| Order history + spend + favourites | Customer | Reorder, CRM segments | `orders`, `v_customer_stats` | Café members | Indefinite | ❌ |
| OTP code (hashed) | Customer | Verify handset before showing history | `customer_otp_challenges` (bcrypt) | none (RPC only) | Expires 10 min; rows linger | n/a |
| Customer session token (hashed) | Customer | Keep "my orders" unlocked | `customer_sessions` (sha256) | none (RPC only) | 90 days | auto-expires |
| Owner/staff email | Staff | Auth, account | `auth.users`, `profiles`, `cafes.email` | self, platform admin; **`cafes.email` anon-exposed (F-02)** | Indefinite | account-level |
| Owner/staff auth | Staff | Login | Supabase Auth | Supabase | Managed | Supabase |
| Payment references | Both | Reconciliation | `payments.reference`, Razorpay IDs | Café members | Indefinite | ❌ |
| Café Razorpay secret | Café | Take online payments | `cafe_payment_secrets` (AES-256-GCM) | none (RPC/service-role) | Until disconnect | disconnect RPC |
| Audit logs | Staff actions | Integrity | `audit_logs`, `platform_audit_logs` | café members / admins | Indefinite | ❌ (intended) |

**IP addresses / device fingerprints / geolocation:** not collected/stored in the DB (good — data minimisation). Vercel/Supabase will process request IPs at the infra layer (must be disclosed as processor activity).

**Minimisation verdict:** collection is reasonable and purpose-linked. The gaps are **lifecycle** (no retention limit, no deletion/export workflow) and **access breadth** (any staff role can read the full customer DB — see SECURITY F-08).

---

## 2. India DPDP posture (Digital Personal Data Protection Act, 2023)

KhaoPiyo (Ventron) is a **Data Processor** for café-customer data (the café is the Data Fiduciary) and a **Data Fiduciary** for its own café-owner/staff accounts. Classify:

| Requirement | Status | Class |
|---|---|---|
| Published privacy notice (purpose, categories, rights, contact) | ❌ placeholder | **REQUIRED** |
| Lawful purpose + notice at collection (customer phone on QR) | ⚠️ implicit only | **LIKELY REQUIRED** |
| Grievance / DPO contact mechanism | ❌ none | **REQUIRED** |
| Data-principal rights: access, correction, erasure | ❌ no workflow | **REQUIRED** (erasure), correction/access LIKELY |
| Processor agreement café↔KhaoPiyo (roles, sub-processors) | ❌ none (Terms placeholder) | **LIKELY REQUIRED** |
| Sub-processor disclosure (Supabase, Vercel, Razorpay, SMS) | ❌ | **REQUIRED** in notice |
| Breach-notification process | ❌ undocumented | **LIKELY REQUIRED** |
| Retention limits / deletion on purpose end | ❌ indefinite | **LIKELY REQUIRED** |
| Children's data | Low relevance (café ordering); no age gate | NEEDS LEGAL REVIEW |
| Consent for non-essential processing | Only essential cookies used (good) | BEST PRACTICE |

> DPDP operational rules/enforcement timelines were still settling as of this writing — **confirm current effective obligations and any Fiduciary thresholds with counsel** before relying on this table. Do not market as "DPDP compliant" until reviewed.

---

## 3. Legal pages

| Page | Exists | State | Action |
|---|---|---|---|
| Privacy Policy | `/legal/privacy` | **placeholder** | Write real notice (§4) — **REQUIRED** |
| Terms & Conditions | `/legal/terms` | **placeholder** | Write SaaS terms — **REQUIRED**, lawyer-review |
| Cookie note | `/legal/cookies` | placeholder (accurate: essential-only) | Fold into privacy; low effort |
| Refund/Cancellation | ❌ | missing | Needed once subscriptions bill — **LIKELY REQUIRED** |
| Data deletion / request | ❌ | missing | Needed for DPDP erasure — **REQUIRED** |
| Grievance / Contact | ❌ | missing | **REQUIRED** — name a contact + email |

---

## 4. Privacy-policy content that must be accurate (do NOT over-claim)

Must state, truthfully: operator = Ventron; that **cafés control their customer data and KhaoPiyo processes it on their behalf**; data collected (phone, name, order history, staff accounts, payment references); purposes; **named sub-processors — Supabase (DB/auth/storage), Vercel (hosting), Razorpay (payments, only if the café enables it), and the SMS provider (MSG91/Twilio)** each process data; retention; security measures (RLS, encryption at rest for payment secrets, TLS) **without** claiming "100% secure" or "we never share data" (infra providers process it); how to request deletion/correction and the grievance contact; policy-change process.

---

## 5. GST validation required (separate sign-off)

Code implements: per-café GSTIN/legal-name/state/invoice-prefix, `gst_registered` toggle, per-item HSN/SAC + tax %, CGST/SGST split (`tax/2`), financial-year invoice numbering (`INV/FY/000001`, atomic counter, idempotent, snapshotted), inclusive/exclusive pricing, proportional discount, GST-on-products-only (no service charge in tax base).

**Before marketing as "GST compliant," a qualified Indian CA must confirm:** CGST/SGST vs **IGST** for inter-state supply (only CGST/SGST implemented — inter-state not handled); rounding rules (per-line vs invoice, Section 170); mandatory invoice fields & format for a restaurant; composition-scheme cases; whether service charge/packaging attracts GST for the café's category; HSN/SAC correctness; credit-note format for refunds; e-invoice/IRN applicability by turnover. **Do not claim compliance from code review alone.** (Tracked as `GST_VALIDATION_REQUIRED` — this section is that list.)

---

## 6. Priority

- **P1:** publish real Privacy Policy + Grievance/contact + data-deletion path (DPDP); write Terms before billing anyone.
- **P2:** retention limits + a customer-data erasure RPC (owner-triggered "delete customer" that scrubs phone/name/history); narrow customer-DB access by role (F-08); fix `cafes.email` anon exposure (SECURITY F-02).
- **P3:** cookie note into privacy; processor agreement template for cafés.
