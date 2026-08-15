-- ============================================================================
-- 0133 — Actually close the cafe_tables.token leak. Supersedes 0132.
--
-- WHY 0132 DID NOTHING
-- 0132 ran `revoke select (token) on cafe_tables from anon` and expected the
-- token column to disappear. It didn't. Verified live after 0132 was applied:
--
--   GET /rest/v1/cafe_tables?select=id,label,token   ->  200, rows returned
--
-- A column-level REVOKE cannot subtract from a blanket table-level GRANT. In
-- Postgres a role may read a column if it holds EITHER the table-level SELECT
-- privilege OR a column-level one, so while `grant select on cafe_tables to
-- anon` stands (it comes from 00-reset.sql's `alter default privileges …`), the
-- column revoke is a no-op. This repo already learned that lesson in 0049 —
-- "Column privileges only bite once the blanket table privilege is gone" — and
-- 0132 failed to follow it. The statements in 0132 are harmless; they are left
-- in place as history rather than edited after the fact.
--
-- THE ACTUAL HOLE, restated
-- 0001:105 creates `create policy "public read" on cafe_tables for select
-- using (true)` with NO role clause, so it grants row access to anon AND
-- authenticated. Combined with the blanket column grant that meant:
--   - anon could enumerate every table of every café, tokens included, and
--     place_order takes that token as its sole credential (0011:67); and
--   - any signed-in café owner could read every OTHER café's tokens.
--
-- FIX — two independent changes, one per role, because the two roles leak for
-- different reasons and each fix alone would leave the other open:
--
--   authenticated: scope the row policy to anon. The pre-existing "member all"
--     policy (0001:104) already gives members full access to their own café's
--     rows, so owners keep every column of their own tables — including token,
--     which the QR page needs — and lose all sight of other cafés. Keeping the
--     table-level grant is correct here; RLS does the scoping.
--
--   anon: drop the blanket grant first, then grant back only the columns the
--     anonymous surface actually reads — 0049's pattern exactly. token is not
--     among them.
--
-- WHY ANON STILL GETS ANY ROW ACCESS
-- Strictly it no longer needs it: every anonymous table lookup now goes through
-- resolve_table_token() (0131), which is SECURITY DEFINER and so unaffected by
-- either grants or policies. The one remaining anon reader is
-- lib/db.ts listOpenOrders(), which selects (id, label) for the legacy KDS at
-- /kds/[slug]. That path is already inert — `orders` returns [] to anon (probed
-- live), and the function returns early on an empty order list before it ever
-- queries cafe_tables — but granting the three harmless columns keeps it honest
-- rather than leaving a latent 42501 for whoever revives that route.
--
-- NOT AFFECTED
--   place_order, resolve_table_token, list_cafe_tables_with_tokens, get_receipt
--   and every other SECURITY DEFINER function run as the definer.
--   The dashboard's `select('*')` counts (app/dashboard/page.tsx:43,
--   dashboard-client.tsx:89) keep working: authenticated retains the
--   table-level grant, so `*` still expands to every column it may read.
--   menu_items / menu_categories keep their own "public read" policies — the
--   anonymous menu genuinely needs them, and neither carries a secret.
-- ============================================================================

-- ── authenticated: no more cross-tenant row access ─────────────────────────
drop policy if exists "public read" on cafe_tables;
create policy "public read" on cafe_tables for select to anon using (true);

-- Normalise the table grant. RLS ("member all") is what scopes rows now, and
-- this undoes 0132's column revoke, which would otherwise be waiting to bite
-- the moment anything removed the blanket grant.
grant select on cafe_tables to authenticated;

-- ── anon: blanket grant out, minimal column set back in ────────────────────
revoke select on cafe_tables from anon;

grant select (
  id,
  cafe_id,
  label
) on cafe_tables to anon;

-- NOTE: supabase/00-reset.sql contains
--   `alter default privileges in schema public grant all on tables to anon`
-- which re-grants full column access to any table created afterwards. That
-- applies to NEW tables only, so cafe_tables stays restricted — but if
-- 00-reset.sql is ever re-run against a live project, re-apply this file.
-- Same caveat 0049 carries for `cafes`.
