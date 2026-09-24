-- Migration 050 — a curated list of top-performing posts.
--
-- What has worked, kept where the team can see it: the topic, the hook, the
-- views and a link. Entries are either the client's own posts or posts from
-- other accounts worth learning from. They are added by hand, pasted in as a
-- list, or added by the client's own Claude / ChatGPT through the connector
-- ("these ones are good, add them").
-- Safe to re-run.

create table if not exists public.top_posts (
  id          uuid primary key default gen_random_uuid(),
  topic       text not null,                    -- what it was about
  hook        text,                             -- the opening line
  views       bigint,
  link        text,
  platform    text,                             -- instagram | tiktok | youtube | linkedin | x | other
  creator     text,                             -- @handle or channel name
  format      text,                             -- reel, short, carousel, ...
  posted_on   date,
  notes       text,                             -- why it worked
  source      text not null default 'inspiration' check (source in ('own', 'inspiration')),
  video_id    uuid references public.videos (id) on delete set null,   -- when it's one of our own
  added_by    uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists top_posts_views_idx on public.top_posts (views desc nulls last);

alter table public.top_posts enable row level security;

-- Every seat can read the list (writers use it for hooks). Writes go through the
-- server after it has checked the role, so there is no write policy.
drop policy if exists top_posts_select on public.top_posts;
create policy top_posts_select on public.top_posts
  for select using (public.current_app_role() is not null);

grant select on public.top_posts to authenticated;
grant all on public.top_posts to service_role;
