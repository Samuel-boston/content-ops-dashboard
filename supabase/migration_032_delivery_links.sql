-- Migration 032: finished-video links.
--
-- An editor can deliver a finished video as one or more links (Drive, Frame.io,
-- Dropbox…) instead of uploading it. Those live beside the other per-video
-- assets, so video_assets.kind gains a third value. The existing policies
-- (va_select / va_write, gated by can_see_video) already cover it.

alter table video_assets drop constraint if exists video_assets_kind_check;
alter table video_assets
  add constraint video_assets_kind_check check (kind in ('raw', 'other', 'delivery'));
