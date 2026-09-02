-- ============================================================================
-- 0201 — Report each café's desktop app version, so support can see who is
-- running what instead of guessing.
--
-- WHY: on 2026-09-01 a café's automatic printing was broken for a full day, and
-- a large part of why it took so long was that nobody could tell which build
-- any machine was actually running. Two other cafés turned out to have never
-- connected at all. Worse, three separate things make an app silently stay on
-- an old version — a release left as a GitHub draft, an install predating the
-- updater signing-key rotation, and Windows Smart App Control blocking the
-- install step — and all three look identical from the outside: nothing
-- happens. Without the version reported somewhere, every support conversation
-- starts by asking a café owner to find a version number.
--
-- HOW: the print bridge already authenticates against bridge_claim_jobs every
-- 4 seconds. It now sends its own version along with that poll, so the answer
-- arrives continuously and for free rather than needing a new endpoint, a new
-- credential, or anything for staff to do.
--
-- Backward compatible on purpose: p_app_version defaults to null, so a bridge
-- running an older build keeps polling exactly as before and simply reports no
-- version. That matters here — the whole point is to learn about out-of-date
-- installs, so this must not break the very clients it is meant to reveal.
-- ============================================================================

alter table print_bridge_tokens add column if not exists app_version text;

-- ── bridge_claim_jobs: accept and record the reported version ───────────────
--
-- DROP then CREATE rather than CREATE OR REPLACE: adding a parameter makes a
-- new signature, and `create or replace` would leave the old two-argument
-- version in place as a second overload. A call with two arguments would then
-- be ambiguous — exactly the "orphaned overload" failure this schema's own
-- self-checks watch for elsewhere.
drop function if exists bridge_claim_jobs(text, integer);

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

revoke execute on function bridge_claim_jobs(text, integer, text) from public, anon, authenticated;
grant execute on function bridge_claim_jobs(text, integer, text) to service_role;

-- ── op_cafe_health: surface the version to the admin panel ─────────────────
--
-- DROP first for the same reason as above: changing a function's RETURNS TABLE
-- shape is not something CREATE OR REPLACE will do.
drop function if exists op_cafe_health(uuid);

create or replace function op_cafe_health(p_cafe_id uuid default null)
returns table (
  cafe_id uuid, name text, status text,
  days_since_last_order integer, onboarding_percent integer,
  failed_sms_count bigint, days_until_expiry integer,
  app_version text, bridge_last_seen_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_platform_permission('health.view') then raise exception 'not authorized'; end if;

  return query
  select
    c.id, c.name, c.status,
    (extract(day from now() - lo.last_order))::int as days_since_last_order,
    round((
      (o.account_created::int + o.profile_completed::int + o.menu_added::int + o.tables_created::int +
       o.qr_generated::int + o.staff_added::int + o.first_order_placed::int) * 100.0 / 7
    ))::int as onboarding_percent,
    coalesce(sms.failed_count, 0) as failed_sms_count,
    case when c.subscription_ends_at is null then null
         else (extract(day from c.subscription_ends_at - now()))::int end as days_until_expiry,
    br.app_version,
    br.last_seen_at as bridge_last_seen_at
  from cafes c
  left join v_cafe_onboarding o on o.cafe_id = c.id
  left join (
    select o2.cafe_id, max(o2.created_at) as last_order
    from orders o2 where o2.status <> 'cancelled' group by o2.cafe_id
  ) lo on lo.cafe_id = c.id
  left join (
    select s.cafe_id, count(*) as failed_count
    from sms_logs s where s.status = 'failed' group by s.cafe_id
  ) sms on sms.cafe_id = c.id
  -- The most recently active bridge for the café. A café may pair more than
  -- one machine; the freshest check-in is the one worth reporting, and
  -- distinct on + order by is how this schema already picks "latest per group".
  left join (
    select distinct on (t.cafe_id) t.cafe_id, t.app_version, t.last_seen_at
      from print_bridge_tokens t
     where t.revoked_at is null
     order by t.cafe_id, t.last_seen_at desc nulls last
  ) br on br.cafe_id = c.id
  where (p_cafe_id is not null or c.status <> 'archived')
    and (p_cafe_id is null or c.id = p_cafe_id)
  order by c.name;
end $$;

revoke execute on function op_cafe_health(uuid) from public, anon;
grant execute on function op_cafe_health(uuid) to authenticated;

-- ── self-check ───────────────────────────────────────────────────────────
do $$
declare v_count integer;
begin
  -- Exactly one of each, or an ambiguous-overload bug is being shipped.
  select count(*) into v_count from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bridge_claim_jobs';
  if v_count <> 1 then
    raise exception 'expected exactly one bridge_claim_jobs, found % -- an orphaned overload would make every bridge poll ambiguous', v_count;
  end if;

  select count(*) into v_count from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'op_cafe_health';
  if v_count <> 1 then
    raise exception 'expected exactly one op_cafe_health, found %', v_count;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_name = 'print_bridge_tokens' and column_name = 'app_version'
  ) then
    raise exception 'print_bridge_tokens.app_version is missing';
  end if;
end $$;
