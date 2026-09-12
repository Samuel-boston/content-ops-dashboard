-- ===========================================================================
-- Migration 021 — Groq key for AI scripting (free-tier testing)
--
-- AI scripting (hooks, script drafts, captions, idea generation) runs on
-- Groq for now — a free, no-card-required tier, so testing costs nothing.
-- Groq's API is OpenAI-compatible (same request/response shape), so this is
-- a drop-in swap. Whisper transcription (spoken brief -> text) still needs
-- the OpenAI key specifically — neither Groq nor Claude do speech-to-text.
-- Safe to re-run.
-- ===========================================================================

alter table workspace_settings add column if not exists groq_api_key text;
