-- Migration 034: sending a finished video to the VA, on purpose.
--
-- Nothing reaches the VA automatically any more. From a video that's ready to
-- post, the client (or an admin) presses "Send to VA", adds instructions and
-- optionally a cover image, and that's the hand-off. Each variant of the video
-- (the main cut and every hook variant) can then be marked as a trial reel or
-- as a post to the main feed — by the sender, or by the VA when they get to it.

alter table public.videos
  add column if not exists va_notes   text,
  add column if not exists cover_path text,
  add column if not exists va_sent_at timestamptz;

alter table public.trial_posts
  add column if not exists post_as text not null default 'trial';

alter table public.trial_posts drop constraint if exists trial_posts_post_as_check;
alter table public.trial_posts
  add constraint trial_posts_post_as_check check (post_as in ('trial', 'main'));
