-- ============================================================================
-- 0228 — a print_jobs row stuck at status='printing' had no reclaim path
-- anywhere in the schema.
--
-- FOUND (full-product audit, 2026-09-10): bridge.rs's own report() comment
-- claimed "the server's own retry/backoff (migration 0150) eventually
-- reclaims it" for a job the bridge failed to report back on — but neither
-- 0150's original eligibility clause nor 0201's (the current one, below)
-- ever included status = 'printing'. Only 'pending' and a backed-off
-- 'failed' were ever reclaimable. The manual retry_print_job RPC
-- (0027_kot_printing.sql) and its UI button are both gated on status =
-- 'failed' too. So the one case that comment specifically described — the
-- bridge process itself dying (crash, forced kill, machine shutdown)
-- between claiming a job and reporting on it — left that row permanently
-- stuck, with no automatic or manual way back, ever.
--
-- The same full-product audit's Rust-side fix (bridge.rs's process_job) now
-- wraps a job's actual print I/O in a 15s timeout and reports failure on a
-- hang, which already covers "the bridge process is alive but a printer is
-- stuck." This migration covers the other half: the bridge process itself
-- is gone. A 3-minute staleness window is generous slack past that 15s
-- client-side timeout — long enough that a real, slow, still-alive print
-- attempt is never double-claimed out from under itself, short enough that
-- an abandoned job doesn't sit for a whole shift. Reuses the same
-- attempts < 5 cap as the failed-job path, so a printer that's reclaimed
-- and re-stalls repeatedly still eventually stops retrying rather than
-- looping forever.
-- ============================================================================

create or replace function bridge_claim_jobs(
  p_token text,
  p_limit integer default 10,
  p_app_version text default null
)
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

  -- Version is written on the same touch as last_seen_at, and only when the
  -- caller actually sent one: an older bridge that sends nothing must not
  -- erase a version already on record.
  update print_bridge_tokens
     set last_seen_at = now(),
         app_version = coalesce(nullif(trim(coalesce(p_app_version, '')), ''), app_version)
   where token_hash = v_hash;

  -- Claim atomically so two bridges on the same café cannot print twice.
  -- Eligible: any pending job, OR a failed job under the attempt cap whose
  -- backoff window (2^attempts minutes since it last failed) has elapsed,
  -- OR a job stuck at 'printing' for more than 3 minutes (0228 — the bridge
  -- process that claimed it is presumed dead, not just slow) under the same
  -- attempt cap.
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
            or (
              status = 'printing'
              and attempts < 5
              and started_at is not null
              and started_at <= now() - interval '3 minutes'
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

revoke execute on function bridge_claim_jobs(text, integer, text) from public, anon, authenticated;
grant execute on function bridge_claim_jobs(text, integer, text) to service_role;

-- ── self-check ─────────────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bridge_claim_jobs';
  if v_src is null then raise exception 'bridge_claim_jobs does not exist'; end if;
  if v_src !~ 'status = ''printing''' then
    raise exception 'bridge_claim_jobs does not reclaim stale printing jobs';
  end if;
  if v_src !~ 'interval ''3 minutes''' then
    raise exception 'bridge_claim_jobs staleness window is missing or was changed unexpectedly';
  end if;
end $$;
