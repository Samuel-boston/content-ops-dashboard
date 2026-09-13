-- ===========================================================================
-- Migration 026 — carousel slide captions
--
-- Carousels needed a per-slide script, not one script_body for the whole
-- video, and a way to reorder slides without deleting and re-uploading. Both
-- live on the existing carousel_images row: `caption` is the slide's text
-- (written at the scripting stage, before an image even exists — storage_path
-- is already nullable), `position` is now updatable in bulk for drag-reorder.
-- Safe to re-run.
-- ===========================================================================

alter table carousel_images add column if not exists caption text;
