-- ============================================================================
-- 0076 — IP-side half of audit finding F-05. customer_issue_otp already
-- throttles per PHONE (3 per 15 min) — the gap was SMS cost-exhaustion by
-- rotating through many different phone numbers from one IP. This table is
-- only ever touched by the service-role admin client inside
-- app/api/customer/request-otp/route.ts (the one place that actually knows
-- the caller's real IP, from Vercel's trusted proxy headers) — no RLS policy
-- at all, same "zero policy = fully locked" pattern as cafe_payment_secrets.
-- ============================================================================

create table if not exists otp_ip_attempts (
  id         uuid primary key default gen_random_uuid(),
  ip         text not null,
  created_at timestamptz not null default now()
);
create index if not exists otp_ip_attempts_ip_idx on otp_ip_attempts (ip, created_at desc);
alter table otp_ip_attempts enable row level security;
