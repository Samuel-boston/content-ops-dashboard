-- Migration 053 — make publishing safe to retry and safe to run twice.
--
--  * channels_done: networks a job has already posted to, so a retry after a
--    partial failure only does the rest instead of posting everywhere again.
--  * claimed_at: when a runner took the job, so two runners (cron and a click)
--    can't post the same job, and a job left "publishing" by a killed function
--    can be picked up again after ten minutes.
-- Safe to re-run.

alter table public.publish_jobs
  add column if not exists channels_done text[] not null default '{}'::text[],
  add column if not exists claimed_at    timestamptz;
