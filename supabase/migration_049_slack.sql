-- Migration 049 — Slack, two ways: ask the dashboard from Slack, and have the
-- dashboard announce what moves. The bot token and signing secret are secrets
-- (Owner-only via RLS, read server-side with the service role).
-- Safe to re-run.

alter table public.workspace_settings
  add column if not exists slack_bot_token      text,
  add column if not exists slack_signing_secret text,
  add column if not exists slack_bot_user_id    text,
  add column if not exists slack_team_name      text,
  -- Where the dashboard announces things (a channel id like C0123ABCD).
  add column if not exists slack_channel_id     text,
  add column if not exists slack_channel_name   text,
  add column if not exists slack_announce       boolean not null default true;
