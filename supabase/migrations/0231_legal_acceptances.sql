-- ============================================================================
-- 0231 — durable Terms & Conditions / legal-document consent tracking.
--
-- FOUND (T&C consent-flow audit, 2026-09-10): the only existing consent gate
-- anywhere in the product was signup's "I agree to the Terms of Service and
-- Privacy Policy" checkbox — client-side only. Ticking it just set a boolean
-- in React state; it was checked before letting the form submit, but the
-- value itself was never sent to the server and nothing was ever recorded.
-- So even a café owner who genuinely read and ticked the box left no trace
-- that they ever did — "did this account accept the terms, and which
-- version" was unanswerable from the database for every single account.
-- The paid-subscription flow (platform_billing_state / the Razorpay
-- checkout in billing-client.tsx) had no consent step of any kind.
--
-- This adds a minimal, append-only acceptance log plus two RPCs, and
-- nothing else — no change to auth, billing, or any existing business logic.
-- doc_version is each legal document's own `updated` display date from
-- lib/legal-content.ts (e.g. '24 July 2026'), not a separate counter to
-- remember to bump — a row is versioned by whatever text was actually shown.
-- ============================================================================

create table if not exists legal_acceptances (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  doc_type    text not null,
  doc_version text not null,
  accepted_at timestamptz not null default now(),
  unique (user_id, doc_type, doc_version)
);

create index if not exists legal_acceptances_user_id_idx on legal_acceptances (user_id);

alter table legal_acceptances enable row level security;

-- Read-only for the owning user; every write goes through the RPCs below
-- (both security definer), matching this project's convention of no direct
-- table access for anything that needs consistent authorization logic.
drop policy if exists "own read" on legal_acceptances;
create policy "own read" on legal_acceptances for select using (auth.uid() = user_id);

revoke all on legal_acceptances from public, anon, authenticated;
grant select on legal_acceptances to authenticated;

-- Records that the CURRENTLY AUTHENTICATED user accepted a specific version
-- of a specific document. Used by the billing/subscribe flow, where the
-- café owner already has a session. `on conflict do nothing` makes this
-- safe to call more than once for the same (user, doc, version) without
-- creating duplicate rows — re-opening and re-agreeing to something you've
-- already accepted this version of is a no-op, not a new record.
create or replace function record_legal_acceptance(p_doc_type text, p_doc_version text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_doc_type is null or length(trim(p_doc_type)) = 0 then
    raise exception 'doc_type is required';
  end if;
  if p_doc_version is null or length(trim(p_doc_version)) = 0 then
    raise exception 'doc_version is required';
  end if;

  insert into legal_acceptances (user_id, doc_type, doc_version)
  values (auth.uid(), p_doc_type, p_doc_version)
  on conflict (user_id, doc_type, doc_version) do nothing;
end $$;

revoke execute on function record_legal_acceptance(text, text) from public, anon;
grant execute on function record_legal_acceptance(text, text) to authenticated;

-- Whether the current user has already accepted this exact version — lets
-- the billing screen skip re-showing the consent modal for someone who's
-- already agreed to the terms currently in force, while still always
-- showing the required "By continuing you agree..." statement and link.
create or replace function has_accepted_legal_doc(p_doc_type text, p_doc_version text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from legal_acceptances
    where user_id = auth.uid() and doc_type = p_doc_type and doc_version = p_doc_version
  );
$$;

revoke execute on function has_accepted_legal_doc(text, text) from public, anon;
grant execute on function has_accepted_legal_doc(text, text) to authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'legal_acceptances') then
    raise exception 'legal_acceptances table was not created';
  end if;
  if not exists (
    select 1 from pg_indexes where schemaname = 'public'
      and tablename = 'legal_acceptances' and indexname like '%user_id%'
  ) then
    raise exception 'legal_acceptances is missing its user_id index';
  end if;
  if not exists (select 1 from pg_proc where proname = 'record_legal_acceptance') then
    raise exception 'record_legal_acceptance does not exist';
  end if;
  if not exists (select 1 from pg_proc where proname = 'has_accepted_legal_doc') then
    raise exception 'has_accepted_legal_doc does not exist';
  end if;
end $$;
