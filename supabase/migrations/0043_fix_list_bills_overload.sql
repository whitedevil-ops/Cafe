-- ============================================================================
-- 0043 — Drop the old 7-argument list_bills so only the payment-aware
-- 8-argument version (0042) remains.
--
-- CAUGHT BY A LIVE TEST, not review: `create or replace function` only
-- replaces a function with the IDENTICAL argument list. Adding `p_payment`
-- in 0042 created a SECOND overload instead of replacing the 0039 one, so a
-- call matched both candidates and PostgREST returned PGRST203 ("could not
-- choose the best candidate function") — the Bills page broke. Removing the
-- old signature leaves exactly one function and resolves the ambiguity.
-- ============================================================================

drop function if exists list_bills(uuid, timestamptz, timestamptz, text, text, integer, integer);
