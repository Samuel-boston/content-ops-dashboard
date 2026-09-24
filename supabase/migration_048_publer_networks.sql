-- Migration 048 — Publer can post to more than Instagram.
--
-- `publer_accounts` maps a network to the Publer account to post to:
--   {"instagram": {"id": "...", "name": "..."}, "youtube": {...}, "tiktok": {...}}
-- The Instagram entry is mirrored in publer_account_id / publer_account_name
-- (migration 044), which older code still reads.
-- Safe to re-run.

alter table public.workspace_settings
  add column if not exists publer_accounts jsonb not null default '{}'::jsonb;

-- Anyone who already connected Instagram keeps working.
update public.workspace_settings
   set publer_accounts = jsonb_build_object(
         'instagram', jsonb_build_object('id', publer_account_id, 'name', coalesce(publer_account_name, ''))
       )
 where publer_account_id is not null
   and publer_accounts = '{}'::jsonb;
