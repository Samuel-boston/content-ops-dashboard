-- 013 — what the Overview needs to stop being a summary of other pages.
--
--   1. `overview_seen_at` — the watermark behind "what's changed since you
--      last looked". Per person, because two people open the dashboard on
--      different rhythms and each needs their own since-when.
--
--   2. Branding — the client's name and logo, so the dashboard reads as their
--      workspace rather than a tool they've been handed. Kept in settings
--      rather than in code: swapping the client is an edit, not a redeploy.

-- 1. Per-person watermark for "What's new" -----------------------------------

alter table public.profiles
  add column if not exists overview_seen_at timestamptz;

comment on column public.profiles.overview_seen_at is
  'Last time this person loaded the Overview. Everything after it is "new" to '
  'them. Written on view, so it is a read receipt rather than a preference.';

-- 2. Branding ----------------------------------------------------------------

alter table public.workspace_settings
  add column if not exists brand_name text,
  add column if not exists brand_logo_path text;

comment on column public.workspace_settings.brand_name is
  'Shown in the nav beside the logo. Falls back to "Content Ops".';

-- A logo is not a secret and is fetched on every page load, so this bucket is
-- public — signing a URL for it on each render would be pure overhead.
insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do update set public = true;

drop policy if exists branding_read on storage.objects;
create policy branding_read on storage.objects for select
  using (bucket_id = 'branding');

-- Only the owner replaces the logo.
drop policy if exists branding_write on storage.objects;
create policy branding_write on storage.objects for insert
  to authenticated
  with check (bucket_id = 'branding' and public.is_owner_or_admin());

drop policy if exists branding_update on storage.objects;
create policy branding_update on storage.objects for update
  to authenticated
  using (bucket_id = 'branding' and public.is_owner_or_admin());

drop policy if exists branding_delete on storage.objects;
create policy branding_delete on storage.objects for delete
  to authenticated
  using (bucket_id = 'branding' and public.is_owner_or_admin());
