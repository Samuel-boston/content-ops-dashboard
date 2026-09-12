-- ===========================================================================
-- Migration 020 — publish job options (cover frame, share to feed)
--
-- Instagram's Reels container endpoint takes more than caption + video:
-- `thumb_offset` picks a frame from the video itself as the cover (no
-- separate image upload needed) and `share_to_feed` decides whether the Reel
-- also lands on the profile grid, not just Reels. Both are real, commonly
-- used publish settings that had no field to set them in.
-- Safe to re-run.
-- ===========================================================================

alter table publish_jobs add column if not exists cover_offset_ms int not null default 0;
alter table publish_jobs add column if not exists share_to_feed boolean not null default true;
