-- ============================================================================
-- Content Ops Dashboard — full schema (Phase 1: foundation)
-- Run in the Supabase SQL editor, or via `npm run db:push` (scripts/apply-sql.mjs).
-- Safe to re-run: drops and recreates everything below.
--
-- Reuses the existing Supabase project that previously hosted the old simple
-- client dashboard. Those tables are dropped here — there is no production data
-- to preserve, and the old dashboard is retired by this build.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Drop the retired "simple dashboard" schema
-- ---------------------------------------------------------------------------
drop table if exists chat_messages cascade;
drop table if exists videos cascade;
drop table if exists people cascade;
drop table if exists month_settings cascade;

-- ---------------------------------------------------------------------------
-- 1. Drop this schema's own objects (for clean re-runs)
-- ---------------------------------------------------------------------------
drop table if exists taxonomy_options cascade;
drop table if exists videos cascade;
drop table if exists profiles cascade;

drop function if exists public.handle_new_user() cascade;
drop function if exists public.current_app_role() cascade;
drop function if exists public.is_staff() cascade;
drop function if exists public.is_owner_or_admin() cascade;
drop function if exists public.is_owner() cascade;
drop function if exists public.videos_assignment_sync() cascade;
drop function if exists public.videos_guard_columns() cascade;
drop function if exists public.videos_touch() cascade;

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 2. profiles — one row per real login, mirrors auth.users, carries the role
-- ---------------------------------------------------------------------------
create table profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text not null default '',
  role       text not null default 'editor' check (role in ('owner', 'admin', 'editor')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table profiles is
  'App users. role drives every RLS policy. Exactly one owner is expected.';

-- Auto-create a profile whenever an auth user is created. Owner/Admin create
-- new logins through the Supabase Auth admin API, passing role + full_name in
-- user_metadata; this trigger copies them across.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'role', 'editor')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 3. Role helper functions (used by RLS policies below)
--    SECURITY DEFINER so they can read profiles without recursing into RLS.
-- ---------------------------------------------------------------------------
create function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create function public.is_staff()
returns boolean
language sql
stable
as $$
  select public.current_app_role() in ('owner', 'admin', 'editor')
$$;

create function public.is_owner_or_admin()
returns boolean
language sql
stable
as $$
  select public.current_app_role() in ('owner', 'admin')
$$;

create function public.is_owner()
returns boolean
language sql
stable
as $$
  select public.current_app_role() = 'owner'
$$;

-- ---------------------------------------------------------------------------
-- 4. videos — the core pipeline record
-- ---------------------------------------------------------------------------
create table videos (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,

  -- Pipeline. NOTE: there is deliberately no "claimed" stage — assigning an
  -- editor is what moves a video from ready_to_edit to in_progress (trigger
  -- videos_assignment_sync below).
  status             text not null default 'ready_to_edit'
                       check (status in (
                         'ready_to_edit', 'in_progress', 'in_review',
                         'revisions', 'approved', 'posted'
                       )),

  -- Ready to Edit queue ordering. Owner/Admin only (enforced by trigger).
  priority           text not null default 'standard'
                       check (priority in ('urgent', 'high', 'standard')),

  -- null = Unassigned (sits in the open pool). Always reassignable, including
  -- back to null, so a wrong assignment never strands a video.
  assigned_editor_id uuid references profiles (id) on delete set null,

  -- Taxonomy — multi-select, free-text customs allowed (see taxonomy_options).
  content_pillars    text[] not null default '{}',
  formats            text[] not null default '{}',
  platforms          text[] not null default '{}',

  -- Calendar / archive
  post_date          date,               -- scheduled or actual post date
  posted_at          timestamptz,        -- set when status -> posted

  -- Interim: link out to Frame.io until the native video engine (Phase 2)
  frameio_url        text,

  -- Brief / inbound notes (the Telegram voice-note automation fills this later)
  brief              text,
  needs_script       boolean not null default false,

  -- Script section (written directly in the record). "Hook variations" here
  -- are script lines — distinct from Phase 2 hook *variants* (separate edits).
  script_hooks       text[] not null default '{}',
  script_body        text,
  script_cta         text,

  -- Stalled-video alerts: when the current stage was entered (trigger-managed).
  stage_entered_at   timestamptz not null default now(),

  created_by         uuid references profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index videos_status_idx        on videos (status);
create index videos_priority_idx      on videos (priority);
create index videos_assigned_idx      on videos (assigned_editor_id);
create index videos_post_date_idx     on videos (post_date);
create index videos_stage_entered_idx on videos (stage_entered_at);

-- 4a. Assigning an editor IS the transition into/out of In Progress.
create function public.videos_assignment_sync()
returns trigger
language plpgsql
as $$
begin
  if new.assigned_editor_id is not null
     and old.assigned_editor_id is null
     and new.status = 'ready_to_edit' then
    new.status := 'in_progress';
  elsif new.assigned_editor_id is null
     and old.assigned_editor_id is not null
     and new.status = 'in_progress' then
    new.status := 'ready_to_edit';
  end if;
  return new;
end;
$$;

create trigger t10_videos_assignment_sync
  before update on videos
  for each row execute function public.videos_assignment_sync();

-- 4b. Column-level write rules for editors (Postgres RLS can't do per-column).
create function public.videos_guard_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_owner_or_admin() then
    return new;
  end if;

  -- Everything below applies to editors (and only to their own rows, which
  -- the RLS USING clause already restricts to).
  if new.priority is distinct from old.priority then
    raise exception 'Only an Owner or Admin can change priority';
  end if;

  if new.post_date is distinct from old.post_date then
    raise exception 'Only an Owner or Admin can set the post date';
  end if;

  if new.assigned_editor_id is distinct from old.assigned_editor_id
     and new.assigned_editor_id is not null
     and new.assigned_editor_id <> auth.uid() then
    raise exception 'Editors can only assign a video to themselves';
  end if;

  if new.status is distinct from old.status
     and new.status in ('approved', 'posted') then
    raise exception 'Only an Owner or Admin can approve or post a video';
  end if;

  return new;
end;
$$;

create trigger t20_videos_guard_columns
  before update on videos
  for each row execute function public.videos_guard_columns();

-- 4c. Timestamps + stage tracking.
create function public.videos_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.stage_entered_at := now();
    if new.status = 'posted' then
      new.posted_at := coalesce(new.posted_at, now());
      new.post_date := coalesce(new.post_date, current_date);
    end if;
  end if;
  return new;
end;
$$;

create trigger t30_videos_touch
  before update on videos
  for each row execute function public.videos_touch();

-- ---------------------------------------------------------------------------
-- 5. taxonomy_options — custom "+ add your own" values, reusable thereafter.
--    Preset lists live in code (src/lib/taxonomy.ts); this stores customs.
-- ---------------------------------------------------------------------------
create table taxonomy_options (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('content_pillar', 'format', 'platform')),
  value      text not null,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (kind, value)
);

-- ============================================================================
-- 6. Row-level security
-- ============================================================================
alter table profiles         enable row level security;
alter table videos           enable row level security;
alter table taxonomy_options enable row level security;

-- service_role bypasses RLS but still needs the table grants.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

-- Authenticated app users go through the anon key + their JWT, so RLS is the
-- real enforcement boundary for everything they do.
grant usage on schema public to authenticated;
grant select, insert, update, delete on profiles, videos, taxonomy_options to authenticated;

-- ---- profiles -------------------------------------------------------------
-- Everyone signed in can see the roster (needed for the assignment dropdown).
create policy profiles_select_staff on profiles
  for select using (public.is_staff());

-- Users may edit their own display name; Owner/Admin may edit anyone.
-- (Role/active changes are further constrained in the server action layer;
--  Owner-only for Admin seats, Owner/Admin for editor seats.)
create policy profiles_update_self on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_update_managers on profiles
  for update using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());

create policy profiles_insert_managers on profiles
  for insert with check (public.is_owner_or_admin());

create policy profiles_delete_owner on profiles
  for delete using (public.is_owner());

-- ---- videos --------------------------------------------------------------
-- Owner/Admin see everything. Editors see only their own assigned videos plus
-- the open Ready to Edit pool.
create policy videos_select_managers on videos
  for select using (public.is_owner_or_admin());

create policy videos_select_editor on videos
  for select using (
    public.current_app_role() = 'editor'
    and (assigned_editor_id = auth.uid() or status = 'ready_to_edit')
  );

create policy videos_insert_managers on videos
  for insert with check (public.is_owner_or_admin());

create policy videos_update_managers on videos
  for update using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());

-- Editors: can update a video they're assigned to, or claim one from the pool.
-- After the update the row must still be theirs, or back in the pool with no
-- editor (dropping a video they grabbed by mistake). The guard trigger blocks
-- priority / post_date / approve / post / assign-to-someone-else.
create policy videos_update_editor on videos
  for update
  using (
    public.current_app_role() = 'editor'
    and (assigned_editor_id = auth.uid() or status = 'ready_to_edit')
  )
  with check (
    public.current_app_role() = 'editor'
    and (
      assigned_editor_id = auth.uid()
      or (assigned_editor_id is null and status = 'ready_to_edit')
    )
  );

create policy videos_delete_managers on videos
  for delete using (public.is_owner_or_admin());

-- ---- taxonomy_options --------------------------------------------------------
create policy taxonomy_select_staff on taxonomy_options
  for select using (public.is_staff());

create policy taxonomy_insert_staff on taxonomy_options
  for insert with check (public.is_staff());

create policy taxonomy_write_managers on taxonomy_options
  for update using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());

create policy taxonomy_delete_managers on taxonomy_options
  for delete using (public.is_owner_or_admin());
