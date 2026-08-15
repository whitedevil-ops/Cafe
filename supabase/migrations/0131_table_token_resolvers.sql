-- ============================================================================
-- 0131 — Resolvers for the QR table token. ADDITIVE ONLY: nothing is revoked
-- here, nothing changes behaviour. Safe to run at any time, including during
-- service.
--
-- THE PROBLEM (the revoke lands in 0132, after the app ships):
--
-- 0001 creates `public read ... using (true)` on cafe_tables, and `token` is a
-- column on that table. Verified against the live database with the public
-- anon key — which ships in the client bundle — every café's table tokens are
-- readable by anyone on the internet:
--
--   GET /rest/v1/cafe_tables?select=id,label,token  ->  200, rows returned
--
-- That matters because place_order takes the token as its sole credential
-- (0011:67 — `select id, cafe_id into v_table_id, v_cafe_id from cafe_tables
-- where token = p_token`). The token is not a strong secret by design — it is
-- printed on a sticker on the table — but reading it should require being in
-- the café, not an HTTP request. Today one anonymous query enumerates every
-- table of every café, so order spam scales to the whole platform at once.
--
-- Confirmed NOT leaking, by the same probe: orders, customers and audit_logs
-- all return 0 rows to anon. Their policies are correct. This is specific to
-- the token column.
--
-- WHY A REVOKE ALONE DOES NOT WORK
--
-- The customer page does `.select('id, label, cafe_id').eq('token', token)`.
-- Postgres requires column-level SELECT privilege for a column referenced in a
-- WHERE clause, not just in the projection — so revoking select(token) breaks
-- ordering for a paying café. The token lookup has to move inside a
-- SECURITY DEFINER function first. That is what this migration adds.
--
-- The owner's QR page (app/dashboard/tables/manage) legitimately needs to READ
-- tokens to render QR codes, so it gets its own member-gated resolver rather
-- than losing the feature.
-- ============================================================================

-- ── Customer path: token -> table + café, without exposing the column ──────
-- Deliberately takes the token and returns everything the three customer
-- pages need (/t/[token], /t/[token]/orders, /t/[token]/wallet) plus the café
-- fields they currently get via a `cafes(...)` join, so each page stays one
-- round trip.
--
-- Returns NULL for an unknown token — callers already handle that with
-- notFound(). It deliberately does NOT reveal whether a token merely belongs
-- to an archived table versus not existing at all.

create or replace function resolve_table_token(p_token text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'table_id',  t.id,
    'label',     t.label,
    'cafe_id',   c.id,
    'cafe_name', c.name,
    'logo_url',  c.logo_url,
    'timezone',  c.timezone
  )
  from cafe_tables t
  join cafes c on c.id = t.cafe_id
  where t.token = p_token;
$$;

-- The QR menu is used by anonymous guests, so anon must be able to call this.
-- That is fine: it takes a token you must already possess and returns only
-- what that one table's menu page displays.
revoke all on function resolve_table_token(text) from public;
grant execute on function resolve_table_token(text) to anon, authenticated;

comment on function resolve_table_token(text) is
  'Resolves a QR table token to its table and café. Exists so the token column itself can be revoked from anon in 0132 — a WHERE clause needs column SELECT privilege, so the lookup must happen inside a definer function.';

-- ── Owner path: list this café''s tables WITH their tokens ─────────────────
-- Gated on is_cafe_member, so an authenticated user cannot read another
-- café's tokens — which the `public read using (true)` policy would otherwise
-- allow even after anon is revoked.

create or replace function list_cafe_tables_with_tokens(p_cafe_id uuid)
returns table (id uuid, label text, capacity integer, status text, token text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_cafe_member(p_cafe_id) then
    raise exception 'not authorized';
  end if;

  return query
  select t.id, t.label, t.capacity, t.status::text, t.token
    from cafe_tables t
   where t.cafe_id = p_cafe_id
     and coalesce(t.archived, false) = false
   order by t.label;
end;
$$;

revoke all on function list_cafe_tables_with_tokens(uuid) from public, anon;
grant execute on function list_cafe_tables_with_tokens(uuid) to authenticated;

comment on function list_cafe_tables_with_tokens(uuid) is
  'Member-gated. The QR-code page needs real tokens to render codes; this is how it gets them once the column is revoked in 0132.';
