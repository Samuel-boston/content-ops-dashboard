-- Migration 047 — a thumbnail for every video, at every stage.
--
-- A video can have a thumbnail of its own: uploaded ready-made, or designed by
-- ChatGPT (gpt-image-1) from a prompt plus reference images. The references come
-- from the B-Roll library (the Footage index) or are uploaded by hand.
-- Files live in a private `thumbnails` bucket and are only ever handed out as
-- short-lived signed links by the server.
-- Safe to re-run.

alter table public.videos
  add column if not exists thumbnail_path       text,
  add column if not exists thumbnail_prompt     text,
  add column if not exists thumbnail_updated_at timestamptz;

create table if not exists public.video_thumbnail_refs (
  id           uuid primary key default gen_random_uuid(),
  video_id     uuid not null references public.videos (id) on delete cascade,
  source       text not null check (source in ('library', 'upload')),
  shot_id      text,            -- library_shots.id when source = 'library'
  storage_path text,            -- thumbnails bucket key when source = 'upload'
  label        text,
  position     int not null default 0,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists video_thumbnail_refs_video_idx on public.video_thumbnail_refs (video_id, position);

alter table public.video_thumbnail_refs enable row level security;

-- Anyone who can see the video can see its references. Writes go through the
-- server (service role) after it has checked the caller's role.
drop policy if exists vtr_select on public.video_thumbnail_refs;
create policy vtr_select on public.video_thumbnail_refs
  for select using (public.can_see_video(video_id));

grant select on public.video_thumbnail_refs to authenticated;
grant all on public.video_thumbnail_refs to service_role;

insert into storage.buckets (id, name, public)
values ('thumbnails', 'thumbnails', false)
on conflict (id) do nothing;
