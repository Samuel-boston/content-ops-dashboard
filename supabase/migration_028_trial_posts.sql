-- ===========================================================================
-- Migration 028 — Trial posts (hook-variant trial reels, tracked end to end)
--
-- The client tests hooks as Instagram TRIAL reels: each hook variant goes out
-- as a trial (shown to non-followers only), the numbers decide which hook
-- earns the main feed. Two hard facts shape this table:
--
--   1. Meta's Graph API cannot post a reel AS a trial, and cannot see a reel
--      while it IS one — trials are invisible in /media and have no media id
--      until "shared to everyone". So trials are posted BY HAND (the VA's
--      job) and their numbers are typed in from the app's own insights
--      screen. The columns here are that manual record.
--   2. The moment a trial is promoted to the main feed it becomes a normal
--      media object — from there the EXISTING machinery takes over
--      (publish_jobs → video_metrics via the Graph API). `promoted_job_id`
--      is the handoff.
--
-- One row = one trial run of one cut (usually a `video_cuts` row with
-- kind='hook'; cut_id is nullable so a trial posted before variants existed
-- can still be recorded). Lifecycle: planned → posted → promoted/archived.
-- `winner` is the client's verdict per video — at most one, enforced the
-- same way video_cuts enforces one main cut (partial unique index).
--
-- RLS: owner/admin only. The VA works through service-role server actions
-- that hand-pick fields (the MCP/guest-link pattern) — see posting-actions.
-- Safe to re-run.
-- ===========================================================================

create table if not exists public.trial_posts (
  id                 uuid primary key default gen_random_uuid(),
  video_id           uuid not null references public.videos (id) on delete cascade,
  cut_id             uuid references public.video_cuts (id) on delete set null,
  label              text not null default '',   -- the hook line / variant label at queue time
  caption            text,                        -- what the VA pastes under the trial
  status             text not null default 'planned'
                       check (status in ('planned', 'posted', 'promoted', 'archived')),
  scheduled_for      timestamptz,                 -- when the VA should post it
  posted_at          timestamptz,
  posted_by          uuid references public.profiles (id) on delete set null,
  permalink          text,                        -- pasted back after posting

  -- Manual numbers, read off the IG app's trial insights (see fact 1 above).
  views              bigint,
  likes              bigint,
  comments           bigint,
  shares             bigint,
  saves              bigint,
  metrics_updated_at timestamptz,
  metrics_updated_by uuid references public.profiles (id) on delete set null,

  winner             boolean not null default false,
  promoted_job_id    uuid references public.publish_jobs (id) on delete set null,
  notes              text,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now()
);

create index if not exists trial_posts_video_idx  on public.trial_posts (video_id);
create index if not exists trial_posts_queue_idx  on public.trial_posts (status, scheduled_for);
create unique index if not exists trial_posts_one_winner
  on public.trial_posts (video_id) where winner;

alter table public.trial_posts enable row level security;

drop policy if exists trial_posts_managers on public.trial_posts;
create policy trial_posts_managers on public.trial_posts for all
  using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());

-- Gotcha 6 (see README): RLS is only consulted after a plain GRANT passes.
grant select, insert, update, delete on public.trial_posts to authenticated;
grant all on public.trial_posts to service_role;

-- Safe to re-run.
