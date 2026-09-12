-- ===========================================================================
-- Migration 005 — table grants for cut_transcripts
--
-- RLS decides *which rows* a user sees, but Postgres still needs a plain table
-- GRANT before the policy is even consulted. Migration 004 created
-- cut_transcripts and its policies but never granted it, so every read failed
-- with "permission denied for table cut_transcripts" and the Transcript tab
-- silently showed "no transcript yet".
--
-- The default privileges below stop the same thing happening to the next table.
-- Safe to re-run.
-- ===========================================================================

grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

grant select, insert, update, delete on public.cut_transcripts to authenticated;

-- Any table added from here on is granted to both roles automatically; RLS
-- remains the actual access boundary.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
