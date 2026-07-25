-- ============================================================================
-- 0068 — Feedback App: post-order ratings, collected at the one touchpoint
-- every customer already reaches — the receipt page (/r/[token]) — keyed by
-- the same receipt_token already trusted to authorize viewing the bill and
-- starting an online payment. No new customer-facing token, no separate
-- "leave a review" link to distribute.
--
-- Internal-only (owner/staff dashboard), not a public review site — that is
-- a materially different, bigger feature (public display, moderation,
-- spam/abuse surface) and wasn't asked for.
--
-- One feedback row per order, upserted rather than one-shot-only: a
-- customer revisiting their receipt link to fix a typo or change their mind
-- overwrites their own row — same "let people correct their own mistake"
-- pattern as held orders and coupon re-entry, not a locked-in first answer.
-- ============================================================================

create table if not exists feedback (
  id          uuid primary key default gen_random_uuid(),
  cafe_id     uuid not null references cafes(id) on delete cascade,
  order_id    uuid not null references orders(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  rating      integer not null check (rating between 1 and 5),
  comment     text,
  created_at  timestamptz not null default now(),
  unique (order_id)
);
create index if not exists feedback_cafe_idx on feedback (cafe_id, created_at desc);

alter table feedback enable row level security;
drop policy if exists "member read" on feedback;
create policy "member read" on feedback for select using (is_cafe_member(cafe_id));
-- No insert/update/delete policy — only through submit_feedback below.

create or replace function submit_feedback(p_token uuid, p_rating integer, p_comment text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order_id    uuid;
  v_cafe_id     uuid;
  v_customer_id uuid;
begin
  select id, cafe_id, customer_id into v_order_id, v_cafe_id, v_customer_id
    from orders where receipt_token = p_token;
  if v_order_id is null then raise exception 'order not found'; end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'rating must be between 1 and 5';
  end if;

  insert into feedback (cafe_id, order_id, customer_id, rating, comment)
  values (v_cafe_id, v_order_id, v_customer_id, p_rating, nullif(trim(coalesce(p_comment, '')), ''))
  on conflict (order_id) do update
    -- created_at deliberately kept as-is (not bumped to now()) — an edited
    -- rating is a correction, not new activity jumping the feedback list.
    set rating = excluded.rating, comment = excluded.comment, created_at = feedback.created_at;

  return jsonb_build_object('ok', true);
end $$;

revoke execute on function submit_feedback(uuid, integer, text) from public;
grant execute on function submit_feedback(uuid, integer, text) to anon, authenticated;

-- ── Summary for the owner dashboard / feedback page ─────────────────────────
create or replace function feedback_summary(p_cafe_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not is_cafe_member(p_cafe_id) then raise exception 'not authorized'; end if;

  select jsonb_build_object(
    'count', count(*),
    'avg_rating', coalesce(round(avg(rating)::numeric, 2), 0),
    'by_star', jsonb_build_object(
      '5', count(*) filter (where rating = 5),
      '4', count(*) filter (where rating = 4),
      '3', count(*) filter (where rating = 3),
      '2', count(*) filter (where rating = 2),
      '1', count(*) filter (where rating = 1)
    )
  ) into v_result
  from feedback
  where cafe_id = p_cafe_id and created_at >= p_from and created_at < p_to;

  return v_result;
end $$;

revoke execute on function feedback_summary(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function feedback_summary(uuid, timestamptz, timestamptz) to authenticated;
