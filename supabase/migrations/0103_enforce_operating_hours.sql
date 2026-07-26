-- ============================================================================
-- 0103 — Operating hours were configurable on the café profile page ("Shown
-- on your public menu") but were never actually READ anywhere outside that
-- editor — not displayed on the QR menu, and not checked by ordering at all.
-- A café marked closed on Sunday still took customer orders on Sunday; the
-- setting was purely cosmetic. Reported directly from a live café's profile
-- screen.
--
-- Fix: public_cafe_ordering_enabled (0084, the existing QR-ordering kill
-- switch anonymous customers already hit on every menu load) now also
-- checks cafe_settings.hours for TODAY, in the café's own timezone, after
-- the existing plan/override check passes. Reuses the exact same "Ordering
-- is paused" customer-facing screen — no new UI needed, the message already
-- reads fine for either reason.
--
-- Fails OPEN on anything missing or malformed (no cafe_settings row, no
-- entry for today, unparseable times) — a café that never touched the
-- Preferences page is unaffected, same posture as every other check in
-- this function.
-- ============================================================================

create or replace function public_cafe_ordering_enabled(p_table_token text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_cafe_id   uuid;
  v_override  boolean;
  v_plan_key  text;
  v_features  jsonb;
  v_kill_open boolean;
  v_tz        text;
  v_hours     jsonb;
  v_day_key   text;
  v_day       jsonb;
  v_open      time;
  v_close     time;
  v_now_time  time;
begin
  select cafe_id into v_cafe_id from cafe_tables where token = p_table_token;
  if v_cafe_id is null then return true; end if;

  select enabled into v_override from cafe_feature_overrides
    where cafe_id = v_cafe_id and feature_key = 'qr_ordering';

  if v_override is not null then
    v_kill_open := v_override;
  else
    select plan into v_plan_key from cafes where id = v_cafe_id;
    select features into v_features from platform_plans where key = v_plan_key;
    v_kill_open := v_features is null or coalesce((v_features ->> 'qr_ordering')::boolean, true);
  end if;

  if not v_kill_open then return false; end if;

  -- ── Operating hours ────────────────────────────────────────────────────
  select c.timezone, s.hours into v_tz, v_hours
    from cafes c left join cafe_settings s on s.cafe_id = c.id
   where c.id = v_cafe_id;

  if v_hours is null or v_hours = '{}'::jsonb then return true; end if;

  v_day_key := (array['sun','mon','tue','wed','thu','fri','sat'])
               [extract(dow from now() at time zone coalesce(v_tz, 'Asia/Kolkata'))::int + 1];
  v_day := v_hours -> v_day_key;
  if v_day is null then return true; end if;
  if coalesce((v_day ->> 'closed')::boolean, false) then return false; end if;

  begin
    v_open  := nullif(v_day ->> 'open', '')::time;
    v_close := nullif(v_day ->> 'close', '')::time;
  exception when others then
    return true; -- malformed time strings never block ordering
  end;
  if v_open is null or v_close is null then return true; end if;

  v_now_time := (now() at time zone coalesce(v_tz, 'Asia/Kolkata'))::time;
  if v_close >= v_open then
    return v_now_time >= v_open and v_now_time <= v_close;
  else
    -- Overnight window (e.g. open 18:00, close 02:00).
    return v_now_time >= v_open or v_now_time <= v_close;
  end if;
end $$;

revoke execute on function public_cafe_ordering_enabled(text) from public;
grant execute on function public_cafe_ordering_enabled(text) to anon, authenticated;
