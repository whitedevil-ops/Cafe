-- ============================================================================
-- 0246 — let the desktop print bridge claim jobs straight from the database,
-- instead of through a Vercel serverless route.
--
-- WHY: the bridge polls every 4 seconds, per café, around the clock. Routed
-- through POST /api/print/poll that is ~21,600 Vercel Function Invocations a
-- day from ONE paired PC — about 648K of the Hobby plan's 1,000,000 a month.
-- On 2026-10-09 the team hit 100% of the quota (Vercel warns that exceeding it
-- pauses the projects). The route does nothing but forward the call to this
-- function, so the bridge can call it directly and Vercel is no longer in the
-- loop for the highest-volume traffic in the product.
--
-- WHAT CHANGES: bridge_claim_jobs was service_role-only (0027, re-asserted by
-- 0150, 0201 and 0228). It is now also executable by `anon` — the role the
-- public (publishable) API key maps to, the same key every browser already
-- carries. `authenticated` stays revoked: the bridge never has a user session.
--
-- WHY THIS IS NOT A NEW EXPOSURE: the function authenticates the caller
-- ITSELF. It refuses a token shorter than 32 characters, hashes the rest, and
-- resolves it to exactly one café — every query after that is filtered by that
-- café, and it is SECURITY DEFINER, so nothing about the caller's role widens
-- what it can read. The tokens are 32 random bytes (gen_random_bytes(32),
-- 0027), i.e. 256 bits, stored only as a SHA-256 hash — not guessable. The
-- public /api/print/poll route was already callable by anyone on the internet
-- and was gated by that same token check and nothing else, so this exposes the
-- same capability behind the same gate, one hop closer.
--
-- KEEP THIS GRANT: 0150, 0201 and 0228 each re-created this function and ended
-- with `revoke ... from anon`. Any future migration that re-bodies
-- bridge_claim_jobs MUST re-grant to anon, or every bridge that polls directly
-- falls back to the Vercel route (see desktop/src-tauri/src/bridge.rs) — it
-- keeps printing, but the invocation savings quietly vanish. The self-check at
-- the bottom of this file is the template to copy.
--
-- The bridge's other call, POST /api/print/report, stays on Vercel: it fires
-- once per printed ticket, not once per 4 seconds, so it is not the problem.
-- ============================================================================

grant execute on function bridge_claim_jobs(text, integer, text) to anon;

-- ── self-check ─────────────────────────────────────────────────────────────
do $$
declare v_count integer;
begin
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bridge_claim_jobs';
  if v_count <> 1 then
    raise exception 'expected exactly one bridge_claim_jobs, found % -- an orphaned overload would make every bridge poll ambiguous', v_count;
  end if;

  if not has_function_privilege('anon', 'bridge_claim_jobs(text, integer, text)', 'execute') then
    raise exception 'anon cannot execute bridge_claim_jobs -- the desktop bridge would fall back to the Vercel route on every poll';
  end if;

  if has_function_privilege('authenticated', 'bridge_claim_jobs(text, integer, text)', 'execute') then
    raise exception 'authenticated can execute bridge_claim_jobs -- only service_role and anon (the bridge) should be able to';
  end if;

  if not has_function_privilege('service_role', 'bridge_claim_jobs(text, integer, text)', 'execute') then
    raise exception 'service_role lost execute on bridge_claim_jobs -- the /api/print/poll fallback would break';
  end if;
end $$;
