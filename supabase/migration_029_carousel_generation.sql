-- ===========================================================================
-- Migration 029 — AI-generated carousel slides
--
-- Carousel slides stop being upload-only: a slide's image can now be
-- GENERATED from its caption (gpt-image-1, via the workspace's existing
-- openai_api_key — no new credential). Three small columns carry it:
--
--   · videos.carousel_style — the per-carousel art direction ("prompt
--     context"): one description of the look every slide shares, written
--     once at the scripting stage. Kept on the video, not per slide, so a
--     10-slide carousel stays visually one piece.
--   · carousel_images.gen_prompt / gen_at — what was asked of the model last
--     time and when; a regeneration shows its history instead of being a
--     mystery, and "Regenerate: <change>" builds on it.
--   · carousel_images.ref_shot_ids — library shots (migration 030) whose
--     frames are sent along as image references, so generated slides can be
--     grounded in the client's real footage rather than invented faces.
--
-- No new storage: generated PNGs land in the existing `carousels` bucket via
-- the same slot-filling registration the editor upload path uses.
-- Safe to re-run.
-- ===========================================================================

alter table public.videos
  add column if not exists carousel_style text;

alter table public.carousel_images
  add column if not exists gen_prompt text;
alter table public.carousel_images
  add column if not exists gen_at timestamptz;
alter table public.carousel_images
  add column if not exists ref_shot_ids text[] not null default '{}';

-- Safe to re-run.
