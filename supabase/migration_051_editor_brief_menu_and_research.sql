-- Migration 051
--
-- 1. The editor brief is a menu, not a stage: a video sitting in it goes back to
--    Ready to Film (the brief pops up when it is next moved). Carousels lose
--    "Creatives to Review": those go back to Creatives (status needs_creatives).
-- 2. The Monday research routine: an editable prompt, an optional outgoing
--    webhook, and whether the AI adds what it finds without asking first.
-- Safe to re-run.

update public.videos set status = 'ready_to_film' where status = 'editor_brief';
update public.videos set status = 'needs_creatives' where status = 'creative_review';

alter table public.workspace_settings
  add column if not exists research_prompt       text,
  add column if not exists research_webhook_url  text,
  add column if not exists research_auto_add     boolean not null default true;
