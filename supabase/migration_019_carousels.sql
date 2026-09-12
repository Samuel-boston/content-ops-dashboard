-- ===========================================================================
-- Migration 019 — carousel images
--
-- Carousel posts ("Carousel with text" format) are a sequence of images, not
-- a video — they never need Cloudflare Stream. This table is the deliverable
-- for a carousel video, the same role cut_versions plays for a normal video:
-- one row per image, ordered by `position`. Images land in Supabase Storage
-- (bucket `carousels`) exactly like footage/references already do.
-- Safe to re-run.
-- ===========================================================================

create table if not exists carousel_images (
  id           uuid primary key default gen_random_uuid(),
  video_id     uuid not null references videos (id) on delete cascade,
  position     int not null default 0,
  storage_path text,                 -- Supabase Storage: carousels/<path>
  size_bytes   bigint,
  uploaded_by  uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists carousel_images_video_idx on carousel_images (video_id, position);

alter table carousel_images enable row level security;

drop policy if exists ci_select on carousel_images;
create policy ci_select on carousel_images for select using (public.can_see_video(video_id));
drop policy if exists ci_write on carousel_images;
create policy ci_write on carousel_images for all
  using (public.can_see_video(video_id)) with check (public.can_see_video(video_id));

-- Gotcha 6 (see README): RLS is only consulted after a plain GRANT passes.
grant select, insert, update, delete on public.carousel_images to authenticated;
grant all on public.carousel_images to service_role;

-- Storage bucket + policies, same shape as migration_011 (music/references/footage).
insert into storage.buckets (id, name, public)
values ('carousels', 'carousels', false)
on conflict (id) do nothing;

drop policy if exists carousels_select on storage.objects;
create policy carousels_select on storage.objects for select to authenticated
  using (bucket_id = 'carousels');
drop policy if exists carousels_insert on storage.objects;
create policy carousels_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'carousels');
drop policy if exists carousels_update on storage.objects;
create policy carousels_update on storage.objects for update to authenticated
  using (bucket_id = 'carousels') with check (bucket_id = 'carousels');
drop policy if exists carousels_delete on storage.objects;
create policy carousels_delete on storage.objects for delete to authenticated
  using (bucket_id = 'carousels');
