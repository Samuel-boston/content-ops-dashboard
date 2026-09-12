-- ===========================================================================
-- Migration 024 — Multiple AI providers
--
-- Text-generation AI (script drafts, hooks, ideas, tags, summaries) ran on
-- Groq alone. Widens workspace_settings so the workspace can instead run on
-- real Claude (Anthropic) or OpenAI — whichever a given team/client actually
-- wants to pay for and use — via one provider switch, without touching any
-- of the features themselves. Whisper transcription is untouched: it always
-- uses openai_api_key regardless of which provider is chosen here.
--
-- Safe to re-run.
-- ===========================================================================

alter table public.workspace_settings add column if not exists ai_provider text not null default 'groq';
alter table public.workspace_settings add column if not exists anthropic_api_key text;

alter table public.workspace_settings drop constraint if exists workspace_settings_ai_provider_check;
alter table public.workspace_settings add constraint workspace_settings_ai_provider_check
  check (ai_provider in ('groq', 'anthropic', 'openai'));
