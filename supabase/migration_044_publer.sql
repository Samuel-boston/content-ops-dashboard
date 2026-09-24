-- Publer as a posting channel: post and schedule Reels (including trial reels)
-- from the dashboard through the client's own Publer account.
--
-- The API key is a secret and lives in workspace_settings (Owner-only via RLS,
-- read server-side with the service role). Nothing here is sent to the browser.
--
-- Safe to re-run.

alter table public.workspace_settings
  add column if not exists publer_api_key       text,
  add column if not exists publer_workspace_id  text,
  add column if not exists publer_account_id    text,
  add column if not exists publer_account_name  text,
  -- What a trial reel does after posting. MANUAL: stays a trial until promoted.
  -- SS_PERFORMANCE: Instagram may share it to followers itself if it does well.
  add column if not exists publer_trial_mode    text not null default 'MANUAL'
    check (publer_trial_mode in ('MANUAL', 'SS_PERFORMANCE'));

alter table public.publish_jobs
  -- Posted as an Instagram trial reel (Publer only).
  add column if not exists as_trial       boolean not null default false,
  -- Which route actually carried it: 'instagram' (Graph API) or 'publer'.
  add column if not exists provider       text,
  add column if not exists publer_job_id  text,
  add column if not exists permalink      text;
