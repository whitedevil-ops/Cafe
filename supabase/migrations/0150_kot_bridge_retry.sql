-- ============================================================================
-- 0150 — KOT print bridge: retry/backoff + expose `kind` to the bridge.
--
-- Context: 0027 built the print_jobs queue, the bridge token auth, and the
-- bridge_claim_jobs/bridge_report_job RPCs, but no consumer program was ever
-- written to poll them — printing has continued to happen client-side from
-- the Kitchen page instead (window.print()/native ESC/POS), which only works
-- while that page is open. This migration is part of building the actual
-- consumer (a background task inside the existing Tauri desktop app). Two
-- changes, both to bridge_claim_jobs, same signature, no arity change:
--
--   1. RETRY: a 'failed' job is now reclaimable, not stuck forever. Capped at
--      5 attempts, with exponential backoff (2^attempts minutes) so a printer
--      that's briefly offline doesn't get hammered by rapid retries.
--   2. KIND: the claim response now includes each job's `kind` (kot |
--      kot_update | reprint | test) alongside its payload, so the bridge can
--      pick the right ticket layout — a plain `document` blob alone doesn't
--      tell it whether this is a full ticket or a change-KOT delta (added by
--      0151, which reuses this response shape).
-- ============================================================================

create or replace function bridge_claim_jobs(p_token text, p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_cafe_id uuid;
  v_hash    text;
  v_jobs    jsonb;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'invalid bridge token'; end if;
  v_hash := encode(digest(p_token, 'sha256'), 'hex');

  select cafe_id into v_cafe_id from print_bridge_tokens
   where token_hash = v_hash and revoked_at is null;
  if v_cafe_id is null then raise exception 'invalid bridge token'; end if;

  update print_bridge_tokens set last_seen_at = now() where token_hash = v_hash;

  -- Claim atomically so two bridges on the same café cannot print twice.
  -- Eligible: any pending job, OR a failed job under the attempt cap whose
  -- backoff window (2^attempts minutes since it last failed) has elapsed.
  with claimed as (
    update print_jobs
       set status = 'printing', started_at = now(), attempts = attempts + 1
     where id in (
       select id from print_jobs
        where cafe_id = v_cafe_id
          and (
            status = 'pending'
            or (
              status = 'failed'
              and attempts < 5
              and completed_at is not null
              and completed_at <= now() - make_interval(mins => (2 ^ attempts)::int)
            )
          )
        order by created_at
        limit greatest(coalesce(p_limit, 10), 1)
        for update skip locked
     )
     returning id, printer_id, kind, payload
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'job_id', c.id,
           'kind', c.kind,
           'printer', jsonb_build_object(
             'id', p.id, 'name', p.name, 'connection_type', p.connection_type,
             'ip_address', p.ip_address, 'port', p.port, 'paper_width', p.paper_width),
           'document', c.payload
         )), '[]'::jsonb)
    into v_jobs
    from claimed c
    left join kot_printers p on p.id = c.printer_id;

  return jsonb_build_object('cafe_id', v_cafe_id, 'jobs', v_jobs);
end $$;

-- Signature is unchanged (text, integer) so the existing lockdown still
-- applies automatically, but restate it explicitly rather than relying on
-- that — a reader of this file alone should see the grant, not have to trust
-- that CREATE OR REPLACE preserved it.
revoke execute on function bridge_claim_jobs(text, integer) from public, anon, authenticated;
grant execute on function bridge_claim_jobs(text, integer) to service_role;
