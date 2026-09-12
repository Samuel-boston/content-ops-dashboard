-- ===========================================================================
-- Migration 023 — Video references + guest asset packages
--
-- Widens reference_items.kind to allow 'video', alongside the existing
-- 'image' and 'link'. Needed for the Telegram automation that attaches a
-- forwarded clip (an Instagram/TikTok share, say) to the idea it creates —
-- the clip is stored in the same "references" bucket an uploaded reference
-- image already uses, just as a video file instead.
--
-- Also widens guest_links.purpose to allow 'assets': a third kind of guest
-- link alongside 'review' and 'upload' — a QR code that hands a phone a
-- downloadable package (brief, raw footage, references) instead of asking
-- for something back. For a trial/freelance editor with no dashboard login.
--
-- Safe to re-run.
-- ===========================================================================

alter table public.reference_items drop constraint if exists reference_items_kind_check;
alter table public.reference_items add constraint reference_items_kind_check
  check (kind in ('image', 'link', 'video'));

alter table public.guest_links drop constraint if exists guest_links_purpose_check;
alter table public.guest_links add constraint guest_links_purpose_check
  check (purpose in ('review', 'upload', 'assets'));
