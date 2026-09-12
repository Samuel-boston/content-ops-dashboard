-- 017 — a shelf for work that isn't happening yet.
--
-- Until now a video was either in the pipeline or posted. Anything the client
-- wanted to make "at some point" had to sit in a real stage, where it padded
-- the counts, showed up in the runway, and quietly made every queue look
-- busier than it was. The honest answer is a third state: still ours, still
-- described, just not now.
--
-- Deliberately a flag rather than a stage. A parked video keeps the stage it
-- was parked from, so bringing it back is one click and lands it exactly where
-- it left off — rather than dumping everything back into Ideation and losing
-- the script that was already written.

alter table public.videos
  add column if not exists parked_at timestamptz,
  add column if not exists parked_reason text;

comment on column public.videos.parked_at is
  'Set when the video is shelved for later. Parked videos keep their stage but '
  'are excluded from boards, queues, counts and the runway.';

create index if not exists videos_parked_idx on public.videos (parked_at)
  where parked_at is not null;
