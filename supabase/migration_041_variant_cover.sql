-- Each variant can have its own cover; the video-wide cover is the fallback.
alter table public.trial_posts add column if not exists cover_path text;
