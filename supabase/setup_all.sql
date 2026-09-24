-- ONE-FILE DATABASE SETUP: schema.sql + every migration, in order. Run once on a new Supabase project.

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

-- ----- migration_002_engine_library_analytics.sql -----
-- ============================================================================
-- Migration 002 — video engine, library layer, analytics, publishing, automations
-- Additive on top of schema.sql (Phase 1). Safe to re-run.
-- Apply:  node scripts/apply-sql.mjs supabase/migration_002_engine_library_analytics.sql
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- videos: extra columns for archive / raw footage / posting
-- ---------------------------------------------------------------------------
alter table videos add column if not exists raw_footage_url text;
alter table videos add column if not exists drive_file_url  text;   -- where the cut(s) moved after Posted
alter table videos add column if not exists archived_at     timestamptz;

-- ---------------------------------------------------------------------------
-- workspace_settings — single row, Owner-only. Integration config lives here so
-- the eventual move to the client's own accounts is a settings edit, not a redeploy.
-- ---------------------------------------------------------------------------
create table if not exists workspace_settings (
  id                       int primary key default 1 check (id = 1),
  -- Cloudflare Stream (active-review video)
  cf_account_id            text,
  cf_stream_token          text,
  cf_stream_customer_code  text,          -- the customer-xxxx subdomain for playback
  -- Google Drive (raw footage + posted archive)
  drive_folder_id          text,
  drive_service_account    jsonb,
  -- Meta / Instagram Graph API (analytics + publishing)
  ig_user_id               text,
  ig_access_token          text,
  ig_token_expires_at      timestamptz,
  -- Telegram automations
  telegram_bot_token       text,
  telegram_chat_ids        bigint[] not null default '{}',
  telegram_user_ids        bigint[] not null default '{}',
  -- OpenAI (Whisper transcription for the voice-note automation)
  openai_api_key           text,
  updated_by               uuid references profiles (id) on delete set null,
  updated_at               timestamptz not null default now()
);
insert into workspace_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- video_cuts — a "video engine citizen": the main cut, plus unlimited hook
-- variants. Each cut has its own version stack, comments and notes.
-- ---------------------------------------------------------------------------
create table if not exists video_cuts (
  id          uuid primary key default gen_random_uuid(),
  video_id    uuid not null references videos (id) on delete cascade,
  kind        text not null default 'main' check (kind in ('main', 'hook')),
  label       text not null default 'Main cut',
  -- What's different about this hook variant (e.g. "warmer grade, sped up 15%,
  -- no music"). Null / unused for the main cut.
  notes       text,
  position    int not null default 0,
  created_by  uuid references profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists video_cuts_video_idx on video_cuts (video_id, position);

-- Every video gets exactly one 'main' cut, created with the video.
create unique index if not exists video_cuts_one_main
  on video_cuts (video_id) where kind = 'main';

create or replace function public.videos_create_main_cut()
returns trigger language plpgsql as $$
begin
  insert into public.video_cuts (video_id, kind, label, position, created_by)
  values (new.id, 'main', 'Main cut', 0, new.created_by);
  return new;
end;
$$;
drop trigger if exists t40_videos_create_main_cut on videos;
create trigger t40_videos_create_main_cut
  after insert on videos
  for each row execute function public.videos_create_main_cut();

-- backfill main cuts for any videos that predate this migration
insert into video_cuts (video_id, kind, label, position)
select v.id, 'main', 'Main cut', 0 from videos v
where not exists (select 1 from video_cuts c where c.video_id = v.id and c.kind = 'main');

-- ---------------------------------------------------------------------------
-- cut_versions — v1 / v2 / v3 … each an upload to Cloudflare Stream.
-- ---------------------------------------------------------------------------
create table if not exists cut_versions (
  id               uuid primary key default gen_random_uuid(),
  cut_id           uuid not null references video_cuts (id) on delete cascade,
  version          int not null,
  stream_uid       text,                 -- Cloudflare Stream video UID
  status           text not null default 'uploading'
                     check (status in ('uploading', 'processing', 'ready', 'errored')),
  duration_seconds numeric,
  thumbnail_url    text,
  playback_url     text,                 -- HLS manifest
  drive_file_url   text,                 -- set when moved out of Stream after Posted
  uploaded_by      uuid references profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (cut_id, version)
);
create index if not exists cut_versions_cut_idx on cut_versions (cut_id, version desc);

-- ---------------------------------------------------------------------------
-- cut_comments — pinned to a point or a dragged range on a version's timeline.
-- Threaded (parent_comment_id), resolvable.
-- ---------------------------------------------------------------------------
create table if not exists cut_comments (
  id                uuid primary key default gen_random_uuid(),
  cut_id            uuid not null references video_cuts (id) on delete cascade,
  version           int,                 -- which version it was left on
  parent_comment_id uuid references cut_comments (id) on delete cascade,
  author_id         uuid references profiles (id) on delete set null,
  body              text not null,
  t_start_seconds   numeric,             -- null = general (not pinned)
  t_end_seconds     numeric,             -- null = a point; set = a range
  mentions          uuid[] not null default '{}',
  resolved          boolean not null default false,
  created_at        timestamptz not null default now()
);
create index if not exists cut_comments_cut_idx on cut_comments (cut_id, created_at);

-- ---------------------------------------------------------------------------
-- video_messages — per-video chat (distinct from timeline comments).
-- ---------------------------------------------------------------------------
create table if not exists video_messages (
  id         uuid primary key default gen_random_uuid(),
  video_id   uuid not null references videos (id) on delete cascade,
  author_id  uuid references profiles (id) on delete set null,
  body       text not null,
  mentions   uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists video_messages_video_idx on video_messages (video_id, created_at);

-- ---------------------------------------------------------------------------
-- notifications — one inbox per user (new assignment, @mention, revisions…).
-- ---------------------------------------------------------------------------
create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  kind       text not null check (kind in ('assignment','mention','revision','comment','stalled','system')),
  title      text not null,
  body       text,
  link       text,
  video_id   uuid references videos (id) on delete set null,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications (user_id, read, created_at desc);

-- ---------------------------------------------------------------------------
-- music_tracks — shared library. Category is free text set by the uploader.
-- ---------------------------------------------------------------------------
create table if not exists music_tracks (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  category         text not null default 'Uncategorized',
  storage_path     text not null,        -- Supabase Storage: music/<path>
  duration_seconds numeric,
  uploaded_by      uuid references profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists music_tracks_category_idx on music_tracks (category, title);

-- ---------------------------------------------------------------------------
-- reference_items — inspiration. Attached rides a video's lifecycle; unattached
-- lands in a holding area and auto-archives after ~30 days of no activity.
-- ---------------------------------------------------------------------------
create table if not exists reference_items (
  id             uuid primary key default gen_random_uuid(),
  video_id       uuid references videos (id) on delete cascade,
  kind           text not null check (kind in ('image', 'link')),
  storage_path   text,                   -- Supabase Storage: references/<path>
  url            text,
  note           text,
  status         text not null default 'open' check (status in ('open','used','dismissed','archived')),
  added_by       uuid references profiles (id) on delete set null,
  last_activity_at timestamptz not null default now(),
  archived_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists reference_items_holding_idx
  on reference_items (status, last_activity_at) where video_id is null;

-- ---------------------------------------------------------------------------
-- sop_docs — living playbook, optionally scoped to one Format.
-- ---------------------------------------------------------------------------
create table if not exists sop_docs (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  format     text,                       -- null = general
  body       text not null default '',
  position   int not null default 0,
  updated_by uuid references profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- video_metrics — pulled from the Instagram Graph API once a video is posted.
-- ---------------------------------------------------------------------------
create table if not exists video_metrics (
  id                uuid primary key default gen_random_uuid(),
  video_id          uuid not null references videos (id) on delete cascade,
  source            text not null default 'instagram',
  external_media_id text,
  permalink         text,
  views             bigint,
  likes             bigint,
  comments          bigint,
  shares            bigint,
  saves             bigint,
  reach             bigint,
  fetched_at        timestamptz not null default now(),
  unique (video_id, source)
);

-- ---------------------------------------------------------------------------
-- publish_jobs — schedule / post from the dashboard via the IG Graph API.
-- ---------------------------------------------------------------------------
create table if not exists publish_jobs (
  id              uuid primary key default gen_random_uuid(),
  video_id        uuid not null references videos (id) on delete cascade,
  cut_id          uuid references video_cuts (id) on delete set null,
  caption         text,
  scheduled_for   timestamptz,
  status          text not null default 'scheduled'
                    check (status in ('scheduled','publishing','published','failed','cancelled')),
  ig_creation_id  text,
  ig_media_id     text,
  error           text,
  created_by      uuid references profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  published_at    timestamptz
);
create index if not exists publish_jobs_due_idx on publish_jobs (status, scheduled_for);

-- ---------------------------------------------------------------------------
-- automation_events — audit trail for the 3 Telegram automations.
-- ---------------------------------------------------------------------------
create table if not exists automation_events (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,              -- voice_note_intake | audio_intake | pool_empty_alert | weekly_report
  detail     jsonb,
  video_id   uuid references videos (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- touch triggers for updated_at
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists t_touch_sop on sop_docs;
create trigger t_touch_sop before update on sop_docs
  for each row execute function public.touch_updated_at();
drop trigger if exists t_touch_ws on workspace_settings;
create trigger t_touch_ws before update on workspace_settings
  for each row execute function public.touch_updated_at();

-- When a video is Posted, auto-archive any references attached to it.
create or replace function public.videos_archive_references()
returns trigger language plpgsql as $$
begin
  if new.status = 'posted' and old.status is distinct from 'posted' then
    update public.reference_items
      set status = 'archived', archived_at = now()
      where video_id = new.id and status <> 'archived';
    new.archived_at := coalesce(new.archived_at, now());
  end if;
  return new;
end;
$$;
drop trigger if exists t35_videos_archive_references on videos;
create trigger t35_videos_archive_references
  before update on videos
  for each row execute function public.videos_archive_references();

-- ============================================================================
-- RLS
-- ============================================================================
alter table workspace_settings enable row level security;
alter table video_cuts         enable row level security;
alter table cut_versions       enable row level security;
alter table cut_comments       enable row level security;
alter table video_messages     enable row level security;
alter table notifications      enable row level security;
alter table music_tracks       enable row level security;
alter table reference_items    enable row level security;
alter table sop_docs           enable row level security;
alter table video_metrics      enable row level security;
alter table publish_jobs       enable row level security;
alter table automation_events  enable row level security;

grant all on all tables in schema public to service_role;
grant select, insert, update, delete on
  workspace_settings, video_cuts, cut_versions, cut_comments, video_messages,
  notifications, music_tracks, reference_items, sop_docs, video_metrics,
  publish_jobs, automation_events
  to authenticated;

-- Helper: can the current user see this video? (mirrors the videos SELECT policies)
create or replace function public.can_see_video(v_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.videos v
    where v.id = v_id
      and (
        public.is_owner_or_admin()
        or (public.current_app_role() = 'editor'
            and (v.assigned_editor_id = auth.uid() or v.status = 'ready_to_edit'))
      )
  )
$$;

-- workspace_settings — Owner only.
drop policy if exists ws_all_owner on workspace_settings;
create policy ws_all_owner on workspace_settings
  for all using (public.is_owner()) with check (public.is_owner());

-- video_cuts / cut_versions / cut_comments / video_messages — follow video visibility.
drop policy if exists cuts_select on video_cuts;
create policy cuts_select on video_cuts for select using (public.can_see_video(video_id));
drop policy if exists cuts_write on video_cuts;
create policy cuts_write on video_cuts for all
  using (public.can_see_video(video_id)) with check (public.can_see_video(video_id));

drop policy if exists cv_select on cut_versions;
create policy cv_select on cut_versions for select
  using (exists (select 1 from video_cuts c where c.id = cut_id and public.can_see_video(c.video_id)));
drop policy if exists cv_write on cut_versions;
create policy cv_write on cut_versions for all
  using (exists (select 1 from video_cuts c where c.id = cut_id and public.can_see_video(c.video_id)))
  with check (exists (select 1 from video_cuts c where c.id = cut_id and public.can_see_video(c.video_id)));

drop policy if exists cc_select on cut_comments;
create policy cc_select on cut_comments for select
  using (exists (select 1 from video_cuts c where c.id = cut_id and public.can_see_video(c.video_id)));
drop policy if exists cc_insert on cut_comments;
create policy cc_insert on cut_comments for insert
  with check (
    author_id = auth.uid()
    and exists (select 1 from video_cuts c where c.id = cut_id and public.can_see_video(c.video_id))
  );
drop policy if exists cc_update on cut_comments;
create policy cc_update on cut_comments for update
  using (author_id = auth.uid() or public.is_owner_or_admin())
  with check (author_id = auth.uid() or public.is_owner_or_admin());
drop policy if exists cc_delete on cut_comments;
create policy cc_delete on cut_comments for delete
  using (author_id = auth.uid() or public.is_owner_or_admin());

drop policy if exists vm_select on video_messages;
create policy vm_select on video_messages for select using (public.can_see_video(video_id));
drop policy if exists vm_insert on video_messages;
create policy vm_insert on video_messages for insert
  with check (author_id = auth.uid() and public.can_see_video(video_id));
drop policy if exists vm_delete on video_messages;
create policy vm_delete on video_messages for delete
  using (author_id = auth.uid() or public.is_owner_or_admin());

-- notifications — yours only.
drop policy if exists notif_select on notifications;
create policy notif_select on notifications for select using (user_id = auth.uid());
drop policy if exists notif_update on notifications;
create policy notif_update on notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notif_delete on notifications;
create policy notif_delete on notifications for delete using (user_id = auth.uid());

-- music_tracks — all staff read; anyone adds; managers curate/delete.
drop policy if exists music_select on music_tracks;
create policy music_select on music_tracks for select using (public.is_staff());
drop policy if exists music_insert on music_tracks;
create policy music_insert on music_tracks for insert with check (public.is_staff());
drop policy if exists music_update on music_tracks;
create policy music_update on music_tracks for update using (public.is_staff()) with check (public.is_staff());
drop policy if exists music_delete on music_tracks;
create policy music_delete on music_tracks for delete
  using (uploaded_by = auth.uid() or public.is_owner_or_admin());

-- reference_items — attached: follow video visibility. Unattached: all staff.
drop policy if exists ref_select on reference_items;
create policy ref_select on reference_items for select
  using (video_id is null and public.is_staff() or video_id is not null and public.can_see_video(video_id));
drop policy if exists ref_insert on reference_items;
create policy ref_insert on reference_items for insert
  with check (public.is_staff() and (video_id is null or public.can_see_video(video_id)));
drop policy if exists ref_update on reference_items;
create policy ref_update on reference_items for update using (public.is_staff()) with check (public.is_staff());
drop policy if exists ref_delete on reference_items;
create policy ref_delete on reference_items for delete
  using (added_by = auth.uid() or public.is_owner_or_admin());

-- sop_docs — all staff read; managers edit.
drop policy if exists sop_select on sop_docs;
create policy sop_select on sop_docs for select using (public.is_staff());
drop policy if exists sop_write on sop_docs;
create policy sop_write on sop_docs for all
  using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());

-- video_metrics — follow video visibility (read); writes are service-role only.
drop policy if exists vmet_select on video_metrics;
create policy vmet_select on video_metrics for select using (public.can_see_video(video_id));

-- publish_jobs — managers only.
drop policy if exists pj_all on publish_jobs;
create policy pj_all on publish_jobs for all
  using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());

-- automation_events — managers read; writes service-role only.
drop policy if exists ae_select on automation_events;
create policy ae_select on automation_events for select using (public.is_owner_or_admin());

-- ---------------------------------------------------------------------------
-- Storage buckets (private) for music + references. Access via signed URLs
-- minted server-side.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('music', 'music', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('references', 'references', false)
  on conflict (id) do nothing;

-- ----- migration_003_ordering_search_assets.sql -----
-- ============================================================================
-- Migration 003 — fix the notifications table collision, correct priority
-- ordering, search, raw-footage assets, activity trail. Additive + idempotent.
--
-- NOTE on section 0: this Supabase project contained an abandoned second
-- schema (workspaces / goals / payments / invitations / video_versions / …)
-- from an earlier experiment. Its `notifications` table shadowed ours —
-- migration 002's `create table if not exists notifications` silently did
-- nothing, so every notification insert failed against the wrong columns.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Rebuild notifications with OUR shape. The shadowing table is empty and
--    belongs to the abandoned schema, so replacing it loses nothing.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notifications' and column_name = 'workspace_id'
  ) then
    drop table public.notifications cascade;
  end if;
end $$;

create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  kind       text not null check (kind in ('assignment','mention','revision','comment','stalled','system')),
  title      text not null,
  body       text,
  link       text,
  video_id   uuid references videos (id) on delete set null,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications (user_id, read, created_at desc);
create index if not exists notifications_dedupe_idx on notifications (kind, video_id, created_at desc);

alter table notifications enable row level security;
grant select, insert, update, delete on notifications to authenticated;
grant all on notifications to service_role;

drop policy if exists notif_select on notifications;
create policy notif_select on notifications for select using (user_id = auth.uid());
drop policy if exists notif_update on notifications;
create policy notif_update on notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notif_delete on notifications;
create policy notif_delete on notifications for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 1. priority_rank — a stored generated column so the DB can order the queue
--    correctly. Ordering by the text `priority` sorted alphabetically
--    (high < standard < urgent), which put Urgent LAST. It also meant the
--    Ready to Edit pool could only be priority-sorted within a page.
-- ---------------------------------------------------------------------------
alter table videos add column if not exists priority_rank int
  generated always as (
    case priority when 'urgent' then 3 when 'high' then 2 else 1 end
  ) stored;

create index if not exists videos_queue_order_idx
  on videos (status, priority_rank desc, created_at asc);

-- ---------------------------------------------------------------------------
-- 2. Trigram search across title + brief, for the global (⌘K) search.
-- ---------------------------------------------------------------------------
create extension if not exists pg_trgm;
create index if not exists videos_title_trgm_idx on videos using gin (title gin_trgm_ops);
create index if not exists videos_brief_trgm_idx on videos using gin (brief gin_trgm_ops);
create index if not exists music_title_trgm_idx  on music_tracks using gin (title gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 3. video_assets — raw footage and other source files attached to a video.
--    Raw footage never needs Stream's scrubbing/comments, so it goes to
--    Drive (or Supabase Storage until Drive is configured).
-- ---------------------------------------------------------------------------
create table if not exists video_assets (
  id           uuid primary key default gen_random_uuid(),
  video_id     uuid not null references videos (id) on delete cascade,
  kind         text not null default 'raw' check (kind in ('raw', 'other')),
  label        text not null default '',
  storage_path text,
  drive_url    text,
  external_url text,
  size_bytes   bigint,
  added_by     uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists video_assets_video_idx on video_assets (video_id, created_at desc);

alter table video_assets enable row level security;
grant select, insert, update, delete on video_assets to authenticated;
grant all on video_assets to service_role;

drop policy if exists va_select on video_assets;
create policy va_select on video_assets for select using (public.can_see_video(video_id));
drop policy if exists va_write on video_assets;
create policy va_write on video_assets for all
  using (public.can_see_video(video_id)) with check (public.can_see_video(video_id));

insert into storage.buckets (id, name, public) values ('footage', 'footage', false)
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. video_activity — a lightweight audit trail per video.
-- ---------------------------------------------------------------------------
create table if not exists video_activity (
  id         uuid primary key default gen_random_uuid(),
  video_id   uuid not null references videos (id) on delete cascade,
  actor_id   uuid references profiles (id) on delete set null,
  kind       text not null,
  summary    text not null,
  created_at timestamptz not null default now()
);
create index if not exists video_activity_video_idx on video_activity (video_id, created_at desc);

alter table video_activity enable row level security;
grant select, insert on video_activity to authenticated;
grant all on video_activity to service_role;

drop policy if exists vact_select on video_activity;
create policy vact_select on video_activity for select using (public.can_see_video(video_id));
drop policy if exists vact_insert on video_activity;
create policy vact_insert on video_activity for insert with check (public.can_see_video(video_id));

-- 4a. Record status / assignment / priority changes automatically, so the
--     trail is complete regardless of which code path made the change.
create or replace function public.videos_log_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  ed_name text;
begin
  if new.status is distinct from old.status then
    insert into public.video_activity (video_id, actor_id, kind, summary)
    values (new.id, actor, 'status', format('Moved %s → %s', old.status, new.status));
  end if;

  if new.assigned_editor_id is distinct from old.assigned_editor_id then
    select coalesce(nullif(full_name, ''), email) into ed_name
      from public.profiles where id = new.assigned_editor_id;
    insert into public.video_activity (video_id, actor_id, kind, summary)
    values (new.id, actor, 'assignment',
            case when new.assigned_editor_id is null
                 then 'Unassigned'
                 else format('Assigned to %s', coalesce(ed_name, 'an editor')) end);
  end if;

  if new.priority is distinct from old.priority then
    insert into public.video_activity (video_id, actor_id, kind, summary)
    values (new.id, actor, 'priority', format('Priority %s → %s', old.priority, new.priority));
  end if;

  return new;
end;
$$;

drop trigger if exists t50_videos_log_activity on videos;
create trigger t50_videos_log_activity
  after update on videos
  for each row execute function public.videos_log_activity();

-- ----- migration_004_workspace_ux.sql -----
-- ===========================================================================
-- Migration 004 — Timeliner-style review workspace
--
-- Adds what the three-pane video workspace needs on top of migration 003:
--   * rich comments: voice notes, freehand drawings, file attachments,
--     internal/client visibility, an assignee
--   * per-version transcripts with timed cues (select text -> comment)
--   * manual board ordering (drag and drop within a column)
--   * multi-channel publishing
-- Safe to re-run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Rich comments
-- ---------------------------------------------------------------------------

-- Internal comments stay inside the team; client-visible ones are what a
-- future client portal would show. Editors can read both, so this is a display
-- concern today and an access boundary the moment a client seat exists.
do $$ begin
  create type public.comment_visibility as enum ('internal', 'client');
exception when duplicate_object then null; end $$;

alter table public.cut_comments
  add column if not exists visibility public.comment_visibility not null default 'internal',
  -- Who the comment is addressed to (the "Mike T." chip on the composer).
  add column if not exists assignee_id uuid references public.profiles (id) on delete set null,
  -- Freehand annotation: {strokes:[{color,width,points:[[x,y],…]}], w, h}
  -- Points are normalised 0..1 against the video frame so they scale to any
  -- player size and any source resolution.
  add column if not exists drawing jsonb,
  -- Voice note in the `comment-media` bucket.
  add column if not exists voice_path text,
  add column if not exists voice_duration_seconds numeric,
  -- Pre-computed waveform peaks (0..1), so playback draws instantly without
  -- downloading and decoding the audio first.
  add column if not exists voice_peaks jsonb,
  -- [{path,name,size,type}] in the `comment-media` bucket.
  add column if not exists attachments jsonb not null default '[]'::jsonb;

create index if not exists cut_comments_assignee_idx
  on public.cut_comments (assignee_id) where assignee_id is not null;

-- A comment must carry *something*. Empty body is fine if there's a voice note,
-- a drawing, or an attachment — otherwise it's a stray row.
do $$ begin
  alter table public.cut_comments add constraint cut_comments_has_content check (
    length(coalesce(body, '')) > 0
    or voice_path is not null
    or drawing is not null
    or jsonb_array_length(attachments) > 0
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. Transcripts
-- ---------------------------------------------------------------------------

create table if not exists public.cut_transcripts (
  id uuid primary key default gen_random_uuid(),
  cut_id uuid not null references public.video_cuts (id) on delete cascade,
  version int not null,
  language text not null default 'en',
  -- [{start,end,text}] ordered by start.
  cues jsonb not null default '[]'::jsonb,
  source text not null default 'whisper',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (cut_id, version, language)
);

create index if not exists cut_transcripts_cut_idx on public.cut_transcripts (cut_id);

-- ---------------------------------------------------------------------------
-- 3. Board ordering
-- ---------------------------------------------------------------------------

-- Sparse float ordering: dropping a card between two neighbours averages their
-- positions, so a reorder is a single-row update and never renumbers a column.
-- NULL means "never hand-placed" and sorts by priority_rank then age, which is
-- what the Ready to Edit queue has always done.
alter table public.videos
  add column if not exists board_position double precision;

create index if not exists videos_board_order_idx
  on public.videos (status, board_position nulls last, priority_rank desc, created_at);

-- ---------------------------------------------------------------------------
-- 4. Multi-channel publishing
-- ---------------------------------------------------------------------------

alter table public.publish_jobs
  add column if not exists channels text[] not null default '{instagram}'::text[];

-- ---------------------------------------------------------------------------
-- 5. Storage for comment media
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('comment-media', 'comment-media', false)
on conflict (id) do nothing;

-- Anyone signed in may upload; reads are mediated by signed URLs minted
-- server-side, and the app only ever mints them for comments the viewer can
-- already see (can_see_video()).
drop policy if exists comment_media_insert on storage.objects;
create policy comment_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'comment-media');

drop policy if exists comment_media_select on storage.objects;
create policy comment_media_select on storage.objects for select to authenticated
  using (bucket_id = 'comment-media');

drop policy if exists comment_media_delete on storage.objects;
create policy comment_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'comment-media' and owner = auth.uid());

-- ---------------------------------------------------------------------------
-- 6. RLS for the new table
-- ---------------------------------------------------------------------------

alter table public.cut_transcripts enable row level security;

-- Same rule as every other child table: you can see a transcript exactly when
-- you can see the video it hangs off.
drop policy if exists cut_transcripts_select on public.cut_transcripts;
create policy cut_transcripts_select on public.cut_transcripts for select using (
  public.can_see_video((select video_id from public.video_cuts where id = cut_id))
);

drop policy if exists cut_transcripts_write on public.cut_transcripts;
create policy cut_transcripts_write on public.cut_transcripts for all using (
  public.can_see_video((select video_id from public.video_cuts where id = cut_id))
) with check (
  public.can_see_video((select video_id from public.video_cuts where id = cut_id))
);

-- ----- migration_005_transcript_grants.sql -----
-- ===========================================================================
-- Migration 005 — table grants for cut_transcripts
--
-- RLS decides *which rows* a user sees, but Postgres still needs a plain table
-- GRANT before the policy is even consulted. Migration 004 created
-- cut_transcripts and its policies but never granted it, so every read failed
-- with "permission denied for table cut_transcripts" and the Transcript tab
-- silently showed "no transcript yet".
--
-- The default privileges below stop the same thing happening to the next table.
-- Safe to re-run.
-- ===========================================================================

grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

grant select, insert, update, delete on public.cut_transcripts to authenticated;

-- Any table added from here on is granted to both roles automatically; RLS
-- remains the actual access boundary.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

-- ----- migration_006_pipeline_eta_pricing.sql -----
-- ===========================================================================
-- Migration 006 — full pipeline, ETAs, hook-variant routing, editor pricing
--
--   ideation → scripting → ready_to_edit → in_progress → in_review
--     → revisions ⇄ in_review → approved
--     → (needs variants ? awaiting_variants → final_review : —) → ready_to_post
--     → posted
--
-- ideation and scripting are client-side only; editors never see them.
-- `approved` is a decision, not a resting state: a trigger immediately routes
-- it onward, so no video ever sits in it.
-- Safe to re-run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Statuses
-- ---------------------------------------------------------------------------

alter table public.videos drop constraint if exists videos_status_check;
alter table public.videos add constraint videos_status_check check (status in (
  'ideation', 'scripting', 'ready_to_edit', 'in_progress', 'in_review',
  'revisions', 'approved', 'awaiting_variants', 'final_review',
  'ready_to_post', 'posted'
));

-- priority_rank already exists; extend the board ordering index to the new set.
drop index if exists public.videos_board_order_idx;
create index videos_board_order_idx
  on public.videos (status, board_position nulls last, priority_rank desc, created_at);

-- ---------------------------------------------------------------------------
-- 2. ETAs, variant intent, spoken brief, price snapshot
-- ---------------------------------------------------------------------------

alter table public.videos
  -- The editor's promised delivery for the stage they're currently in.
  -- eta_stage records which stage it was given for, so an edit ETA isn't
  -- mistaken for a revisions ETA after the video moves on.
  add column if not exists eta_at timestamptz,
  add column if not exists eta_stage text,
  add column if not exists eta_set_by uuid references public.profiles (id) on delete set null,
  add column if not exists eta_set_at timestamptz,

  -- Hook variants. Normally derived from the script: more than one hook in
  -- script_hooks means variants are wanted. The client can force it either way
  -- at approval, which is what this override records (null = derive).
  add column if not exists variants_override boolean,

  -- Spoken brief recorded by the client, in the `comment-media` bucket.
  add column if not exists brief_voice_path text,
  add column if not exists brief_voice_duration_seconds numeric,
  add column if not exists brief_voice_peaks jsonb,

  -- Price snapshot, taken when the video is posted so later rate changes
  -- never rewrite what an editor already earned.
  add column if not exists price_cents integer,
  add column if not exists price_breakdown jsonb,
  add column if not exists priced_at timestamptz;

-- Generated so it can be filtered and indexed, and can never drift from the
-- script it's derived from.
alter table public.videos drop column if exists needs_variants;
alter table public.videos add column needs_variants boolean
  generated always as (
    coalesce(variants_override, coalesce(array_length(script_hooks, 1), 0) > 1)
  ) stored;

-- ---------------------------------------------------------------------------
-- 3. Per-editor, per-format pricing
-- ---------------------------------------------------------------------------

create table if not exists public.editor_rates (
  id          uuid primary key default gen_random_uuid(),
  editor_id   uuid not null references public.profiles (id) on delete cascade,
  format      text not null,
  price_cents integer not null default 0 check (price_cents >= 0),
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  unique (editor_id, format)
);

create index if not exists editor_rates_editor_idx on public.editor_rates (editor_id);

-- Surcharge per *extra* hook variant beyond the first, and the display
-- currency. Single-row workspace_settings, Owner-only.
alter table public.workspace_settings
  add column if not exists hook_variant_surcharge_cents integer not null default 200,
  add column if not exists currency text not null default 'USD';

-- ---------------------------------------------------------------------------
-- 4. Pricing helper
-- ---------------------------------------------------------------------------

-- Base rate for the video's first matching format, plus the surcharge for each
-- hook variant after the first ("4 variants = 3 extra"). SECURITY DEFINER so
-- the posting trigger can read rates the acting user may not be allowed to see.
create or replace function public.video_price(p_video_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v            public.videos%rowtype;
  v_base       integer := 0;
  v_format     text;
  v_variants   integer := 0;
  v_surcharge  integer := 200;
  v_extra      integer := 0;
begin
  select * into v from public.videos where id = p_video_id;
  if not found or v.assigned_editor_id is null then
    return jsonb_build_object('total_cents', 0, 'reason', 'no editor assigned');
  end if;

  select coalesce(hook_variant_surcharge_cents, 200) into v_surcharge
    from public.workspace_settings limit 1;

  -- First format that has a rate for this editor.
  select r.format, r.price_cents into v_format, v_base
    from public.editor_rates r
   where r.editor_id = v.assigned_editor_id
     and r.format = any(v.formats)
   order by r.price_cents desc
   limit 1;

  if v_format is null then
    v_base := 0;
  end if;

  -- Delivered hook variants = hook cuts on this video.
  select count(*) into v_variants
    from public.video_cuts c
   where c.video_id = p_video_id and c.kind = 'hook';

  v_extra := greatest(v_variants - 1, 0);

  return jsonb_build_object(
    'total_cents',     coalesce(v_base, 0) + v_extra * v_surcharge,
    'base_cents',      coalesce(v_base, 0),
    'format',          v_format,
    'variants',        v_variants,
    'extra_variants',  v_extra,
    'surcharge_cents', v_surcharge
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Stage machine
-- ---------------------------------------------------------------------------

-- Approval is a decision, not a destination: route it on immediately.
-- Also snapshots the price the moment a video is posted, and clears a stale
-- ETA whenever the stage changes.
create or replace function public.videos_route_stage()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'approved' then
      new.status := case when new.needs_variants then 'awaiting_variants' else 'ready_to_post' end;
    end if;

    -- Once the variants are in and re-checked, the video is ready to go out.
    -- An ETA belongs to the stage it was promised for.
    if new.status is distinct from old.status then
      new.eta_at := null;
      new.eta_stage := null;
      new.eta_set_by := null;
      new.eta_set_at := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists t15_videos_route_stage on public.videos;
create trigger t15_videos_route_stage
  before update on public.videos
  for each row execute function public.videos_route_stage();

-- Price snapshot runs after the row settles, so it sees the final status.
create or replace function public.videos_price_on_post()
returns trigger
language plpgsql
as $$
declare
  v_price jsonb;
begin
  if new.status = 'posted' and (old.status is distinct from 'posted') and new.price_cents is null then
    v_price := public.video_price(new.id);
    update public.videos
       set price_cents = (v_price->>'total_cents')::int,
           price_breakdown = v_price,
           priced_at = now()
     where id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists t90_videos_price_on_post on public.videos;
create trigger t90_videos_price_on_post
  after update on public.videos
  for each row execute function public.videos_price_on_post();

-- ---------------------------------------------------------------------------
-- 6. Editor write rules — extended for the new stages
-- ---------------------------------------------------------------------------

create or replace function public.videos_guard_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_owner_or_admin() then
    return new;
  end if;

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

  -- Editors move work forward for review; they never approve it, publish it,
  -- or push it back into the client's private planning stages.
  if new.status is distinct from old.status
     and new.status in ('approved', 'posted', 'ready_to_post',
                        'final_review', 'ideation', 'scripting') then
    raise exception 'Only an Owner or Admin can move a video to %', new.status;
  end if;

  -- The script is the client's. Editors read it, they don't rewrite it.
  if new.script_hooks is distinct from old.script_hooks
     or new.script_body is distinct from old.script_body
     or new.script_cta is distinct from old.script_cta
     or new.variants_override is distinct from old.variants_override then
    raise exception 'Only an Owner or Admin can edit the script';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. RLS — editors never see the client's planning stages
-- ---------------------------------------------------------------------------

drop policy if exists videos_select_editor on public.videos;
create policy videos_select_editor on public.videos for select using (
  public.current_app_role() = 'editor'
  and status not in ('ideation', 'scripting')
  and (assigned_editor_id = auth.uid() or status = 'ready_to_edit')
);

alter table public.editor_rates enable row level security;

-- The owner sets and sees every rate. An editor sees only their own, and can
-- never write one. Admins get nothing — pay is between the client and the
-- editor.
drop policy if exists editor_rates_owner_all on public.editor_rates;
create policy editor_rates_owner_all on public.editor_rates for all
  using (public.current_app_role() = 'owner')
  with check (public.current_app_role() = 'owner');

drop policy if exists editor_rates_select_own on public.editor_rates;
create policy editor_rates_select_own on public.editor_rates for select
  using (editor_id = auth.uid());

grant select, insert, update, delete on public.editor_rates to authenticated;
grant all on all tables in schema public to service_role;

-- ----- migration_007_guard_service_role.sql -----
-- ===========================================================================
-- Migration 007 — let trusted server-side code past the column guard
--
-- videos_guard_columns() rejects anything is_owner_or_admin() doesn't approve,
-- and that resolves through auth.uid(). The service-role client has no
-- auth.uid(), so every server-side status change was being refused:
-- runPublishJob's "-> posted", the Stream→Drive archive, and the Telegram
-- automations all hit "Only an Owner or Admin can move a video to posted".
--
-- The service role already bypasses RLS by design and is only reachable from
-- our own server code, so it belongs on the same side of this guard.
-- Safe to re-run.
-- ===========================================================================

create or replace function public.videos_guard_columns()
returns trigger
language plpgsql
as $$
begin
  -- No JWT = service_role (cron, webhooks, automations, seed scripts). Trusted
  -- server-side callers; RLS never applied to them either.
  if auth.uid() is null then
    return new;
  end if;

  if public.is_owner_or_admin() then
    return new;
  end if;

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
     and new.status in ('approved', 'posted', 'ready_to_post',
                        'final_review', 'ideation', 'scripting') then
    raise exception 'Only an Owner or Admin can move a video to %', new.status;
  end if;

  if new.script_hooks is distinct from old.script_hooks
     or new.script_body is distinct from old.script_body
     or new.script_cta is distinct from old.script_cta
     or new.variants_override is distinct from old.variants_override then
    raise exception 'Only an Owner or Admin can edit the script';
  end if;

  return new;
end;
$$;

-- ----- migration_008_route_stage_fixes.sql -----
-- ===========================================================================
-- Migration 008 — two fixes to the approval routing added in 006
--
-- 1. `needs_variants` is a GENERATED column, and Postgres computes generated
--    columns *after* BEFORE triggers run — so `new.needs_variants` was always
--    NULL inside videos_route_stage(), and every approval fell through to
--    ready_to_post, skipping Awaiting Variants entirely. Derive it from the
--    source columns instead.
--
-- 2. Trigger order let editors past the guard. t15_route_stage ran *before*
--    t20_guard_columns, so an editor setting status='approved' had it rewritten
--    to 'awaiting_variants' before the guard looked — and awaiting_variants
--    isn't on the guard's blocklist, so the approval went through. Renaming the
--    routing trigger to t25 puts it after the guard, which now sees the raw
--    'approved' and refuses it.
-- Safe to re-run.
-- ===========================================================================

create or replace function public.videos_route_stage()
returns trigger
language plpgsql
as $$
declare
  v_needs_variants boolean;
begin
  if new.status is distinct from old.status then
    if new.status = 'approved' then
      -- Derived here, not read from the generated column, which isn't
      -- populated yet at BEFORE-trigger time.
      v_needs_variants := coalesce(
        new.variants_override,
        coalesce(array_length(new.script_hooks, 1), 0) > 1
      );
      new.status := case when v_needs_variants then 'awaiting_variants' else 'ready_to_post' end;
    end if;

    -- An ETA belongs to the stage it was promised for.
    if new.status is distinct from old.status then
      new.eta_at := null;
      new.eta_stage := null;
      new.eta_set_by := null;
      new.eta_set_at := null;
    end if;
  end if;
  return new;
end;
$$;

-- Re-register after the guard (t20) rather than before it.
drop trigger if exists t15_videos_route_stage on public.videos;
drop trigger if exists t25_videos_route_stage on public.videos;
create trigger t25_videos_route_stage
  before update on public.videos
  for each row execute function public.videos_route_stage();

-- ----- migration_009_features.sql -----
-- ===========================================================================
-- Migration 009 — the agreed feature set
--
--   * a "Ready to Film" stage between scripting and the editors' pool
--   * music: mood/BPM/energy, and which videos a track was actually used on
--   * editor time off (always optional) and month-paid records
--   * guest review links (no account needed)
--   * a reusable hook library
--   * per-person notification preference
-- Safe to re-run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Ready to Film
--
-- Sits after scripting: the script exists, the video hasn't been shot yet.
-- Client-side only — editors never see it, same as ideation and scripting.
-- ---------------------------------------------------------------------------

alter table public.videos drop constraint if exists videos_status_check;
alter table public.videos add constraint videos_status_check check (status in (
  'ideation', 'scripting', 'ready_to_film', 'ready_to_edit', 'in_progress',
  'in_review', 'revisions', 'approved', 'awaiting_variants', 'final_review',
  'ready_to_post', 'posted'
));

drop policy if exists videos_select_editor on public.videos;
create policy videos_select_editor on public.videos for select using (
  public.current_app_role() = 'editor'
  and status not in ('ideation', 'scripting', 'ready_to_film')
  and (assigned_editor_id = auth.uid() or status = 'ready_to_edit')
);

create or replace function public.videos_guard_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if public.is_owner_or_admin() then
    return new;
  end if;
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
     and new.status in ('approved', 'posted', 'ready_to_post', 'final_review',
                        'ideation', 'scripting', 'ready_to_film') then
    raise exception 'Only an Owner or Admin can move a video to %', new.status;
  end if;
  if new.script_hooks is distinct from old.script_hooks
     or new.script_body is distinct from old.script_body
     or new.script_cta is distinct from old.script_cta
     or new.variants_override is distinct from old.variants_override then
    raise exception 'Only an Owner or Admin can edit the script';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Music: how a track feels, and where it's been used
-- ---------------------------------------------------------------------------

alter table public.music_tracks
  add column if not exists mood text,
  add column if not exists energy text,
  add column if not exists bpm integer check (bpm is null or (bpm > 0 and bpm < 400));

-- Attaching a track to a video is the ONLY thing that feeds "where it's been
-- used" — so it has to stay a one-action drag, never a form to fill in.
create table if not exists public.video_music (
  id         uuid primary key default gen_random_uuid(),
  video_id   uuid not null references public.videos (id) on delete cascade,
  track_id   uuid not null references public.music_tracks (id) on delete cascade,
  added_by   uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (video_id, track_id)
);

create index if not exists video_music_track_idx on public.video_music (track_id);
create index if not exists video_music_video_idx on public.video_music (video_id);

-- ---------------------------------------------------------------------------
-- 3. Time off — always optional, never required to pick work up
-- ---------------------------------------------------------------------------

create table if not exists public.editor_time_off (
  id         uuid primary key default gen_random_uuid(),
  editor_id  uuid not null references public.profiles (id) on delete cascade,
  starts_on  date not null,
  ends_on    date not null,
  note       text,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create index if not exists time_off_editor_idx on public.editor_time_off (editor_id, starts_on);

-- ---------------------------------------------------------------------------
-- 4. Marking a month paid
-- ---------------------------------------------------------------------------

create table if not exists public.editor_payments (
  id          uuid primary key default gen_random_uuid(),
  editor_id   uuid not null references public.profiles (id) on delete cascade,
  -- "YYYY-MM" — the month being settled.
  month       text not null check (month ~ '^\d{4}-\d{2}$'),
  amount_cents integer not null default 0,
  note        text,
  paid_at     timestamptz not null default now(),
  paid_by     uuid references public.profiles (id) on delete set null,
  unique (editor_id, month)
);

-- ---------------------------------------------------------------------------
-- 5. Guest review links
-- ---------------------------------------------------------------------------

create table if not exists public.guest_links (
  id         uuid primary key default gen_random_uuid(),
  video_id   uuid not null references public.videos (id) on delete cascade,
  -- Random, unguessable, and the only credential the guest ever has.
  token      text not null unique,
  label      text,
  expires_at timestamptz,
  revoked    boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists guest_links_token_idx on public.guest_links (token);
create index if not exists guest_links_video_idx on public.guest_links (video_id);

-- ---------------------------------------------------------------------------
-- 6. Hook library — openings worth reusing
-- ---------------------------------------------------------------------------

create table if not exists public.hook_snippets (
  id              uuid primary key default gen_random_uuid(),
  text            text not null,
  note            text,
  source_video_id uuid references public.videos (id) on delete set null,
  times_used      integer not null default 0,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 7. Notification preference
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists notify_mode text not null default 'realtime'
    check (notify_mode in ('realtime', 'digest', 'off'));

-- ---------------------------------------------------------------------------
-- 8. RLS + grants
-- ---------------------------------------------------------------------------

alter table public.video_music      enable row level security;
alter table public.editor_time_off  enable row level security;
alter table public.editor_payments  enable row level security;
alter table public.guest_links      enable row level security;
alter table public.hook_snippets    enable row level security;

-- Music attached to a video follows that video's visibility.
drop policy if exists video_music_all on public.video_music;
create policy video_music_all on public.video_music for all
  using (public.can_see_video(video_id))
  with check (public.can_see_video(video_id));

-- Everyone can see who's away (it's a schedule, not a secret); an editor
-- manages their own, and the owner can manage anyone's.
drop policy if exists time_off_select on public.editor_time_off;
create policy time_off_select on public.editor_time_off for select
  using (public.is_staff());

drop policy if exists time_off_write on public.editor_time_off;
create policy time_off_write on public.editor_time_off for all
  using (editor_id = auth.uid() or public.current_app_role() = 'owner')
  with check (editor_id = auth.uid() or public.current_app_role() = 'owner');

-- Payments follow the same rule as rates: owner writes, editor reads own,
-- admins see nothing.
drop policy if exists payments_owner on public.editor_payments;
create policy payments_owner on public.editor_payments for all
  using (public.current_app_role() = 'owner')
  with check (public.current_app_role() = 'owner');

drop policy if exists payments_select_own on public.editor_payments;
create policy payments_select_own on public.editor_payments for select
  using (editor_id = auth.uid());

-- Only the client hands out guest links.
drop policy if exists guest_links_manage on public.guest_links;
create policy guest_links_manage on public.guest_links for all
  using (public.is_owner_or_admin())
  with check (public.is_owner_or_admin());

drop policy if exists hook_snippets_all on public.hook_snippets;
create policy hook_snippets_all on public.hook_snippets for all
  using (public.is_owner_or_admin())
  with check (public.is_owner_or_admin());

grant select, insert, update, delete on
  public.video_music, public.editor_time_off, public.editor_payments,
  public.guest_links, public.hook_snippets
  to authenticated;
grant all on all tables in schema public to service_role;

-- ----- migration_011_storage_policies.sql -----
-- ===========================================================================
-- Migration 011 — storage policies for music, references and footage
--
-- These three buckets were created (migrations 002 and 003) without any
-- policies on storage.objects. RLS is on by default there, so with no policy
-- every object was invisible to normal users: signing a URL failed with
-- "Object not found" even though the file existed. Only `comment-media` ever
-- got policies (migration 004), which is why voice notes worked and music
-- playback, reference images and footage downloads did not.
--
-- Same shape as comment-media: signed-in users may read and write; the app
-- mints short-lived signed URLs and only ever does so for rows the caller can
-- already see through the tables' own RLS.
-- Safe to re-run.
-- ===========================================================================

do $$
declare
  b text;
begin
  foreach b in array array['music', 'references', 'footage'] loop
    execute format('drop policy if exists %I on storage.objects', b || '_select');
    execute format(
      'create policy %I on storage.objects for select to authenticated using (bucket_id = %L)',
      b || '_select', b
    );

    execute format('drop policy if exists %I on storage.objects', b || '_insert');
    execute format(
      'create policy %I on storage.objects for insert to authenticated with check (bucket_id = %L)',
      b || '_insert', b
    );

    execute format('drop policy if exists %I on storage.objects', b || '_update');
    execute format(
      'create policy %I on storage.objects for update to authenticated using (bucket_id = %L) with check (bucket_id = %L)',
      b || '_update', b, b
    );

    execute format('drop policy if exists %I on storage.objects', b || '_delete');
    execute format(
      'create policy %I on storage.objects for delete to authenticated using (bucket_id = %L)',
      b || '_delete', b
    );
  end loop;
end $$;

-- ----- migration_012_ideation_cadence.sql -----
-- 012 — a real ideation surface, and a weekly posting plan.
--
-- Two things the pipeline was missing:
--
--   1. Ideation had nowhere to think. Clicking an idea dropped you straight
--      into the script editor, which is the wrong tool for something that is
--      still just a sentence and a maybe. `idea_notes` is the scratchpad that
--      sits before the script exists.
--
--   2. "Cadence" was a read-out of the past 26 weeks. Useful, but it answered
--      a question nobody was asking. What's actually needed is the plan: what
--      goes out on a Monday, what goes out on a Thursday, and in what format.
--      `cadence_slots` is that plan — one row per intended post per weekday.

-- 1. Brainstorming notes -----------------------------------------------------

alter table public.videos add column if not exists idea_notes text;

comment on column public.videos.idea_notes is
  'Free-form thinking from the Ideation stage. Survives the move into '
  'Scripting so the original spark is still there while the script is written.';

-- 2. The weekly posting plan -------------------------------------------------

create table if not exists public.cadence_slots (
  id uuid primary key default gen_random_uuid(),
  -- ISO weekday: 1 = Monday … 7 = Sunday. Matches Postgres `isodow`, so
  -- comparing the plan against what actually posted is a plain join.
  weekday smallint not null check (weekday between 1 and 7),
  format text not null,
  platform text,
  note text,
  -- Ordering within a day, so two Monday slots keep a stable order.
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists cadence_slots_weekday_idx
  on public.cadence_slots (weekday, position);

comment on table public.cadence_slots is
  'The intended posting rhythm: which formats go out on which weekday. '
  'A template, not a schedule — it never holds video ids.';

-- 3. RLS + grants ------------------------------------------------------------

alter table public.cadence_slots enable row level security;

-- Everyone can see the plan; it tells an editor what is expected of a week.
-- Only the client changes it.
drop policy if exists cadence_select on public.cadence_slots;
create policy cadence_select on public.cadence_slots for select
  using (auth.uid() is not null);

drop policy if exists cadence_write on public.cadence_slots;
create policy cadence_write on public.cadence_slots for all
  using (public.is_owner_or_admin())
  with check (public.is_owner_or_admin());

-- RLS is only consulted after table privileges pass, so this GRANT is not
-- optional — without it every policy above is unreachable.
grant select, insert, update, delete on public.cadence_slots to authenticated;
grant all on public.cadence_slots to service_role;

-- ----- migration_013_overview.sql -----
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

-- ----- migration_014_editor_dashboard.sql -----
-- 014 — the editor's side of the product.
--
-- Until now the editors had a queue and not much else: no sense of what a
-- month had earned them, nowhere to put their payment details, and no route
-- to the client's b-roll. This adds the three things that were missing.

-- 1. B-roll library ----------------------------------------------------------
--
-- The footage itself stays on the client's Google Drive — moving fifty
-- categories of raw video into Supabase would cost more per month than the
-- rest of the product combined. What lives here is the index: a name and a
-- share link per category, so an editor finds the right folder without asking.

create table if not exists public.broll_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Null until someone pastes the Drive share link for this folder.
  drive_url text,
  note text,
  position integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists broll_categories_name_key
  on public.broll_categories (lower(name));
create index if not exists broll_categories_position_idx
  on public.broll_categories (position, name);

comment on table public.broll_categories is
  'Index of the client''s Google Drive b-roll folders. Names and share links '
  'only — the media never enters this system.';

-- 2. How an editor gets paid -------------------------------------------------
--
-- A separate table rather than columns on `profiles`, because every signed-in
-- user can read `profiles` — that's what renders names and avatars. Payment
-- details on that row would be readable by every other editor. Here the
-- policies below can be strict: yours, or the owner's view of everyone's.

create table if not exists public.editor_payment_details (
  editor_id uuid primary key references public.profiles (id) on delete cascade,
  -- Free text rather than a validated URL: people get paid by Wise link, by
  -- PayPal.me, by bank details in a note. Prescribing a format here would
  -- just push the real answer into `note`.
  payment_link text,
  note text,
  updated_at timestamptz not null default now()
);

comment on table public.editor_payment_details is
  'Where each editor wants to be paid. Set by them, read by the owner when '
  'settling a month. Admins never see it.';

alter table public.editor_payment_details enable row level security;

drop policy if exists payment_details_own on public.editor_payment_details;
create policy payment_details_own on public.editor_payment_details for all
  using (editor_id = auth.uid())
  with check (editor_id = auth.uid());

-- The owner settles the invoices, so the owner can read them. Deliberately
-- not `is_owner_or_admin()` — admins have no business with payment details.
drop policy if exists payment_details_owner_read on public.editor_payment_details;
create policy payment_details_owner_read on public.editor_payment_details for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'owner'
    )
  );

grant select, insert, update, delete on public.editor_payment_details to authenticated;
grant all on public.editor_payment_details to service_role;

-- 3. RLS + grants ------------------------------------------------------------

alter table public.broll_categories enable row level security;

-- Everyone signed in can browse the library; only the client curates it.
drop policy if exists broll_select on public.broll_categories;
create policy broll_select on public.broll_categories for select
  using (auth.uid() is not null);

drop policy if exists broll_write on public.broll_categories;
create policy broll_write on public.broll_categories for all
  using (public.is_owner_or_admin())
  with check (public.is_owner_or_admin());

-- RLS is only reached once table privileges pass.
grant select, insert, update, delete on public.broll_categories to authenticated;
grant all on public.broll_categories to service_role;

-- ----- migration_015_editor_months.sql -----
-- 015 — an editor's month is when the work started, not when it posted.
--
-- The old model filed a video into the month it was *posted*, and only counted
-- it once it had been. That's how a client thinks about a content calendar; it
-- isn't how an editor gets paid. An editor who cuts eight videos in September
-- has earned eight videos in September, whatever the client's approval queue
-- is doing in October.
--
-- So: a video belongs to the month it was assigned, and everything assigned in
-- a month counts toward that month's total. Approval still gates *invoicing* —
-- that's a conversation between the two of them, not a rule this schema needs
-- to enforce.

-- 1. When the work started ---------------------------------------------------

alter table public.videos add column if not exists assigned_at timestamptz;

comment on column public.videos.assigned_at is
  'When this video was last handed to an editor. Drives which month it counts '
  'toward on the editor dashboard and on their invoice.';

create index if not exists videos_assigned_at_idx
  on public.videos (assigned_editor_id, assigned_at desc);

-- Reassignment moves the video to the new month, because the new editor is the
-- one doing the work. Unassigning leaves the stamp alone rather than clearing
-- it — a video that bounced back to the bay for an hour shouldn't lose its
-- history.
create or replace function public.videos_stamp_assigned()
returns trigger
language plpgsql
as $$
begin
  if new.assigned_editor_id is not null
     and new.assigned_editor_id is distinct from old.assigned_editor_id then
    new.assigned_at := now();
  end if;
  return new;
end;
$$;

-- t30: after the guard (t20) and the stage router (t25), so it never runs on a
-- write that is about to be rejected. Triggers fire in alphabetical order.
drop trigger if exists t30_videos_stamp_assigned on public.videos;
create trigger t30_videos_stamp_assigned
  before update on public.videos
  for each row execute function public.videos_stamp_assigned();

-- Backfill: best available evidence of when each assigned video started.
update public.videos
   set assigned_at = coalesce(assigned_at, stage_entered_at, created_at)
 where assigned_editor_id is not null
   and assigned_at is null;

-- 2. Per-month billing -------------------------------------------------------
--
-- The payment link belongs to the month, not to the person: an editor may
-- invoice one month through one account and the next through another, and the
-- client needs whatever was true for the month they're settling. The UI
-- pre-fills from the previous month, so in practice it's set once.

create table if not exists public.editor_month_billing (
  editor_id uuid not null references public.profiles (id) on delete cascade,
  -- 'YYYY-MM', matching editor_payments.month.
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  payment_link text,
  note text,
  updated_at timestamptz not null default now(),
  primary key (editor_id, month)
);

comment on table public.editor_month_billing is
  'How an editor wants to be paid for one specific month. Theirs to write, '
  'the owner''s to read when settling.';

alter table public.editor_month_billing enable row level security;

drop policy if exists month_billing_own on public.editor_month_billing;
create policy month_billing_own on public.editor_month_billing for all
  using (editor_id = auth.uid())
  with check (editor_id = auth.uid());

-- Owner only, deliberately not is_owner_or_admin(): admins never see pay.
drop policy if exists month_billing_owner_read on public.editor_month_billing;
create policy month_billing_owner_read on public.editor_month_billing for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
  );

grant select, insert, update, delete on public.editor_month_billing to authenticated;
grant all on public.editor_month_billing to service_role;

-- ----- migration_017_parked.sql -----
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

-- ----- migration_018_series.sql -----
-- 018 — series: a named sequence of videos that belong together.
--
-- A four-part story is currently four unrelated records that happen to sit
-- near each other on the calendar, and nothing stops part three going out
-- before part two. This gives the sequence a name and an order.
--
-- Position is an integer rather than a float: unlike the board, where cards
-- get dragged between neighbours constantly, a series is short and its order
-- is the *story's* order — renumbering three items is not a problem worth
-- sparse-indexing around.

create table if not exists public.series (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.series is
  'A named run of videos released in order — a multi-part story, a course, a '
  'launch sequence.';

alter table public.videos
  add column if not exists series_id uuid references public.series (id) on delete set null,
  add column if not exists series_position integer;

create index if not exists videos_series_idx
  on public.videos (series_id, series_position)
  where series_id is not null;

-- Two videos can't claim the same slot in the same series.
create unique index if not exists videos_series_slot_uniq
  on public.videos (series_id, series_position)
  where series_id is not null and series_position is not null;

alter table public.series enable row level security;

-- Series are workspace-wide planning objects: everyone signed in can read them
-- so an editor can see "part 2 of 4" on their own video, but only the client
-- shapes them.
drop policy if exists series_read on public.series;
create policy series_read on public.series for select
  using (auth.uid() is not null);

drop policy if exists series_write on public.series;
create policy series_write on public.series for all
  using (public.is_owner_or_admin())
  with check (public.is_owner_or_admin());

grant select on public.series to authenticated;
grant insert, update, delete on public.series to authenticated;
grant all on public.series to service_role;

-- ----- migration_019_carousels.sql -----
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

-- ----- migration_020_publish_options.sql -----
-- ===========================================================================
-- Migration 020 — publish job options (cover frame, share to feed)
--
-- Instagram's Reels container endpoint takes more than caption + video:
-- `thumb_offset` picks a frame from the video itself as the cover (no
-- separate image upload needed) and `share_to_feed` decides whether the Reel
-- also lands on the profile grid, not just Reels. Both are real, commonly
-- used publish settings that had no field to set them in.
-- Safe to re-run.
-- ===========================================================================

alter table publish_jobs add column if not exists cover_offset_ms int not null default 0;
alter table publish_jobs add column if not exists share_to_feed boolean not null default true;

-- ----- migration_021_groq.sql -----
-- ===========================================================================
-- Migration 021 — Groq key for AI scripting (free-tier testing)
--
-- AI scripting (hooks, script drafts, captions, idea generation) runs on
-- Groq for now — a free, no-card-required tier, so testing costs nothing.
-- Groq's API is OpenAI-compatible (same request/response shape), so this is
-- a drop-in swap. Whisper transcription (spoken brief -> text) still needs
-- the OpenAI key specifically — neither Groq nor Claude do speech-to-text.
-- Safe to re-run.
-- ===========================================================================

alter table workspace_settings add column if not exists groq_api_key text;

-- ----- migration_022_editor_brief.sql -----
-- ===========================================================================
-- Migration 022 — Editor Brief stage
--
-- A new client-only stage between "Ready to Film" and "Ready to Edit": the
-- assembly step where the brief (voice/written), a screen recording, tagged
-- music and priority all get finished before a video is handed to editors.
-- Same pattern as migration 009's "Ready to Film" addition — no new columns
-- or tables, just widening the status enum and the two places that fence it.
-- Safe to re-run.
-- ===========================================================================

alter table public.videos drop constraint if exists videos_status_check;
alter table public.videos add constraint videos_status_check check (status in (
  'ideation', 'scripting', 'ready_to_film', 'editor_brief', 'ready_to_edit',
  'in_progress', 'in_review', 'revisions', 'approved', 'awaiting_variants',
  'final_review', 'ready_to_post', 'posted'
));

drop policy if exists videos_select_editor on public.videos;
create policy videos_select_editor on public.videos for select using (
  public.current_app_role() = 'editor'
  and status not in ('ideation', 'scripting', 'ready_to_film', 'editor_brief')
  and (assigned_editor_id = auth.uid() or status = 'ready_to_edit')
);

create or replace function public.videos_guard_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if public.is_owner_or_admin() then
    return new;
  end if;
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
     and new.status in ('approved', 'posted', 'ready_to_post', 'final_review',
                        'ideation', 'scripting', 'ready_to_film', 'editor_brief') then
    raise exception 'Only an Owner or Admin can move a video to %', new.status;
  end if;
  if new.script_hooks is distinct from old.script_hooks
     or new.script_body is distinct from old.script_body
     or new.script_cta is distinct from old.script_cta
     or new.variants_override is distinct from old.variants_override then
    raise exception 'Only an Owner or Admin can edit the script';
  end if;
  return new;
end;
$$;

-- ----- migration_023_reference_video.sql -----
-- ===========================================================================
-- Migration 023 — Video references + guest asset packages
--
-- Widens reference_items.kind to allow 'video', alongside the existing
-- 'image' and 'link'. Needed for the Telegram automation that attaches a
-- forwarded clip (an Instagram/TikTok share, say) to the idea it creates —
-- the clip is stored in the same "references" bucket an uploaded reference
-- image already uses, just as a video file instead.
--
-- Also widens guest_links.purpose to allow 'assets': a third kind of guest
-- link alongside 'review' and 'upload' — a QR code that hands a phone a
-- downloadable package (brief, raw footage, references) instead of asking
-- for something back. For a trial/freelance editor with no dashboard login.
--
-- Safe to re-run.
-- ===========================================================================

alter table public.reference_items drop constraint if exists reference_items_kind_check;
alter table public.reference_items add constraint reference_items_kind_check
  check (kind in ('image', 'link', 'video'));

alter table public.guest_links drop constraint if exists guest_links_purpose_check;
alter table public.guest_links add constraint guest_links_purpose_check
  check (purpose in ('review', 'upload', 'assets'));

-- ----- migration_024_ai_provider.sql -----
-- ===========================================================================
-- Migration 024 — Multiple AI providers
--
-- Text-generation AI (script drafts, hooks, ideas, tags, summaries) ran on
-- Groq alone. Widens workspace_settings so the workspace can instead run on
-- real Claude (Anthropic) or OpenAI — whichever a given team/client actually
-- wants to pay for and use — via one provider switch, without touching any
-- of the features themselves. Whisper transcription is untouched: it always
-- uses openai_api_key regardless of which provider is chosen here.
--
-- Safe to re-run.
-- ===========================================================================

alter table public.workspace_settings add column if not exists ai_provider text not null default 'groq';
alter table public.workspace_settings add column if not exists anthropic_api_key text;

alter table public.workspace_settings drop constraint if exists workspace_settings_ai_provider_check;
alter table public.workspace_settings add constraint workspace_settings_ai_provider_check
  check (ai_provider in ('groq', 'anthropic', 'openai'));

-- ----- migration_025_mcp_tokens.sql -----
-- ---------------------------------------------------------------------------
-- personal_access_tokens — lets a user connect their own AI assistant (Claude,
-- ChatGPT, etc.) to this workspace as an MCP client. The token authenticates
-- the /api/mcp endpoint; the raw token is shown to the user exactly once at
-- creation time and only its sha-256 hash is ever stored.
-- ---------------------------------------------------------------------------
create table if not exists public.personal_access_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles (id) on delete cascade,
  label       text not null,
  token_hash  text not null unique,
  last_used_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists personal_access_tokens_user_idx on personal_access_tokens (user_id);

alter table public.personal_access_tokens enable row level security;

-- Everyone can see and manage only their own tokens. The /api/mcp endpoint
-- itself resolves tokens with the service-role client, which bypasses RLS.
drop policy if exists "own tokens" on public.personal_access_tokens;
create policy "own tokens" on public.personal_access_tokens
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ----- migration_026_carousel_captions.sql -----
-- ===========================================================================
-- Migration 026 — carousel slide captions
--
-- Carousels needed a per-slide script, not one script_body for the whole
-- video, and a way to reorder slides without deleting and re-uploading. Both
-- live on the existing carousel_images row: `caption` is the slide's text
-- (written at the scripting stage, before an image even exists — storage_path
-- is already nullable), `position` is now updatable in bulk for drag-reorder.
-- Safe to re-run.
-- ===========================================================================

alter table carousel_images add column if not exists caption text;

-- ----- migration_027_copywriter_va_roles.sql -----
-- ===========================================================================
-- Migration 027 — Copywriter + VA seats, and the Script Review stage
--
-- The client is bringing on a copywriter and a VA, and neither fits the
-- existing three roles:
--
--   · A COPYWRITER lives entirely in the planning half of the pipeline. They
--     work ideas into scripts and hand them to the client for sign-off. They
--     must see and edit ideation/scripting material — which editors, by
--     design, cannot even see — while never touching priority, assignment,
--     posting, analytics or money.
--   · A VA does the posting (above all, trial reels — which Instagram's API
--     cannot post or read, so they are posted by hand from the app). The VA
--     gets NO row access here at all: their surface is served by service-role
--     server actions that hand-pick fields, the same pattern the MCP and
--     guest-link layers already use. RLS-wise a VA is a member of the org
--     (is_staff — so names, taxonomy, SOP resolve) and nothing more.
--
-- The copywriter also needs a finer scripting flow than one "Scripting"
-- stage. New status `script_review` sits between scripting and ready_to_film:
--
--   ideation ("Idea") → scripting ("Ready to Script" / being written)
--     → script_review ("Ready for Review") → [client approves]
--     → ready_to_film ("Script to Record")
--
-- Same pattern as migrations 009/022 (which added stages): widen the CHECK,
-- re-issue the editor SELECT policy, re-create the guard function. Plus the
-- role plumbing: profiles CHECK, is_staff(), can_see_video(), and copywriter
-- policies on videos + hook_snippets.
-- Safe to re-run.
-- ===========================================================================

-- 1. Roles ------------------------------------------------------------------

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner', 'admin', 'editor', 'copywriter', 'va'));

-- "Staff" means any active seat of the workspace. It gates org-wide reads
-- (profile names, taxonomy, SOP, music/reference libraries) — all of which a
-- copywriter needs and none of which are sensitive to a VA.
create or replace function public.is_staff()
returns boolean
language sql
stable
as $$
  select public.current_app_role() in ('owner', 'admin', 'editor', 'copywriter', 'va')
$$;

-- 2. The Script Review stage --------------------------------------------------

alter table public.videos drop constraint if exists videos_status_check;
alter table public.videos add constraint videos_status_check check (status in (
  'ideation', 'scripting', 'script_review', 'ready_to_film', 'editor_brief',
  'ready_to_edit', 'in_progress', 'in_review', 'revisions', 'approved',
  'awaiting_variants', 'final_review', 'ready_to_post', 'posted'
));

-- Editors: planning stages stay invisible, now including script_review.
drop policy if exists videos_select_editor on public.videos;
create policy videos_select_editor on public.videos for select using (
  public.current_app_role() = 'editor'
  and status not in ('ideation', 'scripting', 'script_review', 'ready_to_film', 'editor_brief')
  and (assigned_editor_id = auth.uid() or status = 'ready_to_edit')
);

-- 3. Copywriter row access on videos ----------------------------------------
-- They see the planning half only: everything up to and including Ready to
-- Film (so an approved "Script to Record" stays visible to its author), and
-- nothing from the editing/posting half — no assignment state, no metrics,
-- and prices are only ever stamped at Posted, which they never see.

drop policy if exists videos_select_copywriter on public.videos;
create policy videos_select_copywriter on public.videos for select using (
  public.current_app_role() = 'copywriter'
  and status in ('ideation', 'scripting', 'script_review', 'ready_to_film')
);

-- New ideas start in the planning stages; a copywriter can seed them.
drop policy if exists videos_insert_copywriter on public.videos;
create policy videos_insert_copywriter on public.videos for insert with check (
  public.current_app_role() = 'copywriter'
  and status in ('ideation', 'scripting')
);

-- Edits allowed while the row stays in the planning half, both before and
-- after the write (so they can never move something INTO the editing half —
-- the guard trigger below narrows the allowed moves further).
drop policy if exists videos_update_copywriter on public.videos;
create policy videos_update_copywriter on public.videos for update
  using (
    public.current_app_role() = 'copywriter'
    and status in ('ideation', 'scripting', 'script_review', 'ready_to_film')
  )
  with check (
    public.current_app_role() = 'copywriter'
    and status in ('ideation', 'scripting', 'script_review', 'ready_to_film')
  );

-- can_see_video() mirrors the videos SELECT policies; every child table
-- (comments, assets, references, carousel slides, messages) delegates to it,
-- which is exactly how the copywriter inherits access to planning material.
create or replace function public.can_see_video(v_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.videos v
    where v.id = v_id
      and (
        public.is_owner_or_admin()
        or (public.current_app_role() = 'editor'
            and (v.assigned_editor_id = auth.uid() or v.status = 'ready_to_edit'))
        or (public.current_app_role() = 'copywriter'
            and v.status in ('ideation', 'scripting', 'script_review', 'ready_to_film'))
      )
  )
$$;

-- 4. Column/stage guard, now with a copywriter branch -------------------------
-- Editors keep their existing rules (script fields locked, planning stages
-- unreachable — script_review joins that blocklist). Copywriters are the
-- inverse: script fields are their job, but priority / post date / assignment
-- / variant routing stay management calls, and the only stages they may set
-- are the scripting trio — Ready to Film is the client's approval to give.
create or replace function public.videos_guard_columns()
returns trigger
language plpgsql
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    return new;
  end if;
  if public.is_owner_or_admin() then
    return new;
  end if;
  v_role := public.current_app_role();

  if new.priority is distinct from old.priority then
    raise exception 'Only an Owner or Admin can change priority';
  end if;
  if new.post_date is distinct from old.post_date then
    raise exception 'Only an Owner or Admin can set the post date';
  end if;

  if v_role = 'copywriter' then
    if new.assigned_editor_id is distinct from old.assigned_editor_id then
      raise exception 'Only an Owner or Admin can assign editors';
    end if;
    if new.variants_override is distinct from old.variants_override then
      raise exception 'Only an Owner or Admin can override variant routing';
    end if;
    if new.status is distinct from old.status
       and new.status not in ('ideation', 'scripting', 'script_review') then
      raise exception 'A copywriter can move a script between Idea, Scripting and Script Review — approving it for filming is the client''s call';
    end if;
    return new;
  end if;

  -- editors (and any other non-manager seat)
  if new.assigned_editor_id is distinct from old.assigned_editor_id
     and new.assigned_editor_id is not null
     and new.assigned_editor_id <> auth.uid() then
    raise exception 'Editors can only assign a video to themselves';
  end if;
  if new.status is distinct from old.status
     and new.status in ('approved', 'posted', 'ready_to_post', 'final_review',
                        'ideation', 'scripting', 'script_review', 'ready_to_film',
                        'editor_brief') then
    raise exception 'Only an Owner or Admin can move a video to %', new.status;
  end if;
  if new.script_hooks is distinct from old.script_hooks
     or new.script_body is distinct from old.script_body
     or new.script_cta is distinct from old.script_cta
     or new.variants_override is distinct from old.variants_override then
    raise exception 'Only an Owner or Admin can edit the script';
  end if;
  return new;
end;
$$;

-- 5. Hook Library opens to the copywriter -------------------------------------
-- Curating reusable hooks is scriptwriting work. Delete stays management-only
-- (dropping a proven hook is a bigger call than adding one).
drop policy if exists hook_snippets_all on public.hook_snippets;
create policy hook_snippets_all on public.hook_snippets for all
  using (public.is_owner_or_admin())
  with check (public.is_owner_or_admin());
drop policy if exists hook_snippets_copywriter_select on public.hook_snippets;
create policy hook_snippets_copywriter_select on public.hook_snippets for select
  using (public.current_app_role() = 'copywriter');
drop policy if exists hook_snippets_copywriter_insert on public.hook_snippets;
create policy hook_snippets_copywriter_insert on public.hook_snippets for insert
  with check (public.current_app_role() = 'copywriter');
drop policy if exists hook_snippets_copywriter_update on public.hook_snippets;
create policy hook_snippets_copywriter_update on public.hook_snippets for update
  using (public.current_app_role() = 'copywriter')
  with check (public.current_app_role() = 'copywriter');

-- Safe to re-run.

-- ----- migration_028_trial_posts.sql -----
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

-- ----- migration_029_carousel_generation.sql -----
-- ===========================================================================
-- Migration 029 — AI-generated carousel slides
--
-- Carousel slides stop being upload-only: a slide's image can now be
-- GENERATED from its caption (gpt-image-1, via the workspace's existing
-- openai_api_key — no new credential). Three small columns carry it:
--
--   · videos.carousel_style — the per-carousel art direction ("prompt
--     context"): one description of the look every slide shares, written
--     once at the scripting stage. Kept on the video, not per slide, so a
--     10-slide carousel stays visually one piece.
--   · carousel_images.gen_prompt / gen_at — what was asked of the model last
--     time and when; a regeneration shows its history instead of being a
--     mystery, and "Regenerate: <change>" builds on it.
--   · carousel_images.ref_shot_ids — library shots (migration 030) whose
--     frames are sent along as image references, so generated slides can be
--     grounded in the client's real footage rather than invented faces.
--
-- No new storage: generated PNGs land in the existing `carousels` bucket via
-- the same slot-filling registration the editor upload path uses.
-- Safe to re-run.
-- ===========================================================================

alter table public.videos
  add column if not exists carousel_style text;

alter table public.carousel_images
  add column if not exists gen_prompt text;
alter table public.carousel_images
  add column if not exists gen_at timestamptz;
alter table public.carousel_images
  add column if not exists ref_shot_ids text[] not null default '{}';

-- Safe to re-run.

-- ----- migration_030_library_shots.sql -----
-- ===========================================================================
-- Migration 030 — Footage index (mirror of the B-Roll Librarian archive)
--
-- Nathan's B-Roll Librarian (a local Gemini-powered indexer) analyses every
-- clip and photo in the client's Drive: per-shot captions, actions, settings,
-- emotions, categories, plus a 640px thumbnail frame per shot. That archive
-- lives in SQLite on his machine — this table is its read-only mirror in the
-- dashboard, pushed up by `scripts/sync-broll-library.mjs` after an indexing
-- session.
--
-- Why a mirror and not a live bridge: the librarian binds to 127.0.0.1 with
-- no auth, serves HTML not JSON, and its Drive token expires weekly — none of
-- which a Vercel-hosted client dashboard should depend on. The mirror is
-- plain rows + a tsvector, searched with Postgres FTS; media itself stays in
-- Drive (drive_web_link), thumbnails come along into the `library-thumbs`
-- bucket so the picker works everywhere.
--
-- id is the librarian's shot id, literally "<source_id>-<shot_index>" — a
-- video's Nth detected shot, or a photo's single shot 0. `search_text` is the
-- librarian's own precomputed haystack (caption + facets + tags), so search
-- behaviour here tracks search behaviour there.
--
-- Writes: service-role only (the sync script) — there is deliberately no
-- authenticated write policy. Reads: any seat; the whole team picks visuals.
-- Safe to re-run.
-- ===========================================================================

create table if not exists public.library_shots (
  id              text primary key,
  source_id       text not null,
  media_kind      text not null default 'video' check (media_kind in ('video', 'image')),
  filename        text,
  caption         text,
  action          text,
  setting         text,
  shot_type       text,
  emotions        text[] not null default '{}',
  subjects        text[] not null default '{}',
  category        text,
  featured_person boolean not null default false,
  top_pick        boolean not null default false,
  start_s         double precision,
  end_s           double precision,
  duration_s      double precision,
  drive_file_id   text,
  drive_web_link  text,
  drive_path      text,
  thumb_path      text,          -- library-thumbs/<shot id>.jpg, synced alongside
  search_text     text,
  tsv             tsvector generated always as (to_tsvector('english', coalesce(search_text, ''))) stored,
  synced_at       timestamptz not null default now()
);

create index if not exists library_shots_tsv_idx      on public.library_shots using gin (tsv);
create index if not exists library_shots_kind_idx     on public.library_shots (media_kind);
create index if not exists library_shots_category_idx on public.library_shots (category);

alter table public.library_shots enable row level security;

drop policy if exists library_shots_select on public.library_shots;
create policy library_shots_select on public.library_shots for select
  using (public.is_staff());

-- Gotcha 6 (see README): RLS is only consulted after a plain GRANT passes.
-- No insert/update/delete policy for authenticated — the sync script writes
-- with the service key.
grant select on public.library_shots to authenticated;
grant all on public.library_shots to service_role;

-- Thumbnails bucket, same shape as migration 019's `carousels`.
insert into storage.buckets (id, name, public)
values ('library-thumbs', 'library-thumbs', false)
on conflict (id) do nothing;

drop policy if exists library_thumbs_select on storage.objects;
create policy library_thumbs_select on storage.objects for select to authenticated
  using (bucket_id = 'library-thumbs');

-- Safe to re-run.

-- ----- migration_031_script_creative_revisions.sql -----
-- ===========================================================================
-- Migration 031 — Script Revisions, and a real Creative Review stage for carousels
--
-- Two gaps surfaced once the carousel pipeline (migration 030-era work) and
-- the copywriter/client split (migration 027) were actually used side by
-- side:
--
--   1. Sending a script back had no stage of its own — the client's only
--      option was to leave a comment and hope, or silently move it back to
--      'scripting', which looks identical to "never been reviewed yet". New
--      'script_revisions' status, same shape as the existing post-edit
--      'revisions' status: client sends it back from Script Review, the
--      copywriter (or the client themselves) resubmits to Script Review.
--
--   2. A carousel's Script Review approval used to jump straight to Ready
--      to Post — but the generated/selected IMAGES never got a review step
--      of their own, only the caption text did. New 'creative_review'
--      (images made, awaiting approval) and 'creative_revisions' (images
--      need another pass) — approving a script now lands here instead of
--      Ready to Post directly.
--
-- Same pattern as every stage-adding migration before this one: widen the
-- CHECK, re-issue the editor/copywriter SELECT policies, re-create the
-- guard function. Safe to re-run.
-- ===========================================================================

alter table public.videos drop constraint if exists videos_status_check;
alter table public.videos add constraint videos_status_check check (status in (
  'ideation', 'scripting', 'script_review', 'script_revisions',
  'creative_review', 'creative_revisions',
  'ready_to_film', 'editor_brief',
  'ready_to_edit', 'in_progress', 'in_review', 'revisions', 'approved',
  'awaiting_variants', 'final_review', 'ready_to_post', 'posted'
));

-- Editors: planning stages (now including script_revisions) stay invisible.
-- creative_review/creative_revisions are carousel-only and, structurally, an
-- editor's second AND-condition (assigned_editor_id / ready_to_edit) already
-- excludes every carousel row — listed here too for the same reason the
-- others are: a reader shouldn't have to know that to trust the list.
drop policy if exists videos_select_editor on public.videos;
create policy videos_select_editor on public.videos for select using (
  public.current_app_role() = 'editor'
  and status not in (
    'ideation', 'scripting', 'script_review', 'script_revisions',
    'creative_review', 'creative_revisions', 'ready_to_film', 'editor_brief'
  )
  and (assigned_editor_id = auth.uid() or status = 'ready_to_edit')
);

-- Copywriter: script_revisions joins the planning half they can see and
-- edit — a script sent back for changes is exactly their job. Creative
-- review is the client's call past this point, so it's deliberately NOT
-- added here.
drop policy if exists videos_select_copywriter on public.videos;
create policy videos_select_copywriter on public.videos for select using (
  public.current_app_role() = 'copywriter'
  and status in ('ideation', 'scripting', 'script_review', 'script_revisions', 'ready_to_film')
);

drop policy if exists videos_update_copywriter on public.videos;
create policy videos_update_copywriter on public.videos for update
  using (
    public.current_app_role() = 'copywriter'
    and status in ('ideation', 'scripting', 'script_review', 'script_revisions', 'ready_to_film')
  )
  with check (
    public.current_app_role() = 'copywriter'
    and status in ('ideation', 'scripting', 'script_review', 'script_revisions', 'ready_to_film')
  );

create or replace function public.can_see_video(v_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.videos v
    where v.id = v_id
      and (
        public.is_owner_or_admin()
        or (public.current_app_role() = 'editor'
            and (v.assigned_editor_id = auth.uid() or v.status = 'ready_to_edit'))
        or (public.current_app_role() = 'copywriter'
            and v.status in ('ideation', 'scripting', 'script_review', 'script_revisions', 'ready_to_film'))
      )
  )
$$;

-- Guard function: only the status blocklists changed (script_revisions,
-- creative_review, creative_revisions all join the "manager-only" set for
-- editors — a copywriter was never allowed past script_review anyway, so
-- their branch is unchanged).
create or replace function public.videos_guard_columns()
returns trigger
language plpgsql
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    return new;
  end if;
  if public.is_owner_or_admin() then
    return new;
  end if;
  v_role := public.current_app_role();

  if new.priority is distinct from old.priority then
    raise exception 'Only an Owner or Admin can change priority';
  end if;
  if new.post_date is distinct from old.post_date then
    raise exception 'Only an Owner or Admin can set the post date';
  end if;

  if v_role = 'copywriter' then
    if new.assigned_editor_id is distinct from old.assigned_editor_id then
      raise exception 'Only an Owner or Admin can assign editors';
    end if;
    if new.variants_override is distinct from old.variants_override then
      raise exception 'Only an Owner or Admin can override variant routing';
    end if;
    if new.status is distinct from old.status
       and new.status not in ('ideation', 'scripting', 'script_review') then
      raise exception 'A copywriter can move a script between Idea, Scripting and Script Review — approving it for filming is the client''s call';
    end if;
    return new;
  end if;

  -- editors (and any other non-manager seat)
  if new.assigned_editor_id is distinct from old.assigned_editor_id
     and new.assigned_editor_id is not null
     and new.assigned_editor_id <> auth.uid() then
    raise exception 'Editors can only assign a video to themselves';
  end if;
  if new.status is distinct from old.status
     and new.status in ('approved', 'posted', 'ready_to_post', 'final_review',
                        'ideation', 'scripting', 'script_review', 'script_revisions',
                        'creative_review', 'creative_revisions',
                        'ready_to_film', 'editor_brief') then
    raise exception 'Only an Owner or Admin can move a video to %', new.status;
  end if;
  if new.script_hooks is distinct from old.script_hooks
     or new.script_body is distinct from old.script_body
     or new.script_cta is distinct from old.script_cta
     or new.variants_override is distinct from old.variants_override then
    raise exception 'Only an Owner or Admin can edit the script';
  end if;
  return new;
end;
$$;

-- Safe to re-run.

-- ----- migration_032_delivery_links.sql -----
-- Migration 032: finished-video links.
--
-- An editor can deliver a finished video as one or more links (Drive, Frame.io,
-- Dropbox…) instead of uploading it. Those live beside the other per-video
-- assets, so video_assets.kind gains a third value. The existing policies
-- (va_select / va_write, gated by can_see_video) already cover it.

alter table video_assets drop constraint if exists video_assets_kind_check;
alter table video_assets
  add constraint video_assets_kind_check check (kind in ('raw', 'other', 'delivery'));

-- ----- migration_033_va_tasks.sql -----
-- Migration 033: the VA's "Other" task board.
--
-- Miscellaneous jobs that aren't posting: the client (or an admin) writes a
-- task, gives it a priority and optionally a date and a link, and the VA works
-- through them. Like the rest of the VA's surface this is served by
-- service-role server actions that gate on role — the VA has no direct row
-- access — so the only RLS policy is the managers' own.

create table if not exists public.va_tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  details     text,
  link        text,
  priority    text not null default 'standard' check (priority in ('urgent', 'high', 'standard')),
  due_date    date,
  status      text not null default 'todo' check (status in ('todo', 'done')),
  done_at     timestamptz,
  done_by     uuid references public.profiles (id) on delete set null,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists va_tasks_status_idx on public.va_tasks (status, priority);

alter table public.va_tasks enable row level security;

drop policy if exists va_tasks_managers on public.va_tasks;
create policy va_tasks_managers on public.va_tasks for all
  using (public.is_owner_or_admin())
  with check (public.is_owner_or_admin());

grant select, insert, update, delete on public.va_tasks to authenticated;
grant all on public.va_tasks to service_role;

-- ----- migration_034_va_handoff.sql -----
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

-- ----- migration_035_variants_script_comments_needs_creatives.sql -----
-- Migration 035
--
--  1. 'needs_creatives' — a carousel whose script is approved lands here (the
--     images still have to be made), then goes to Creative Review.
--  2. Editors may submit hook variants: awaiting_variants -> final_review was
--     blocked by the guard ("Only an Owner or Admin can move a video to
--     final_review"), but handing the variants over is the editor's whole job.
--  3. trial_posts becomes the per-variant record: post_as gains 'none' (not
--     selected yet, the new default) and sent_to_va_at marks what's actually
--     been handed to the VA — variants can now exist as drafts without the VA
--     seeing them.
--  4. script_comments — comments on specific parts of a script (a hook, the
--     body, the call to action, a carousel slide), written by the client and
--     answered by the copywriter.
-- Safe to re-run.

-- 1 ---------------------------------------------------------------------------
alter table public.videos drop constraint if exists videos_status_check;
alter table public.videos add constraint videos_status_check check (status in (
  'ideation', 'scripting', 'script_review', 'script_revisions',
  'needs_creatives', 'creative_review', 'creative_revisions',
  'ready_to_film', 'editor_brief',
  'ready_to_edit', 'in_progress', 'in_review', 'revisions', 'approved',
  'awaiting_variants', 'final_review', 'ready_to_post', 'posted'
));

drop policy if exists videos_select_editor on public.videos;
create policy videos_select_editor on public.videos for select using (
  public.current_app_role() = 'editor'
  and status not in (
    'ideation', 'scripting', 'script_review', 'script_revisions',
    'needs_creatives', 'creative_review', 'creative_revisions',
    'ready_to_film', 'editor_brief'
  )
  and (assigned_editor_id = auth.uid() or status = 'ready_to_edit')
);

-- 2 ---------------------------------------------------------------------------
create or replace function public.videos_guard_columns()
returns trigger
language plpgsql
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    return new;
  end if;
  if public.is_owner_or_admin() then
    return new;
  end if;
  v_role := public.current_app_role();

  if new.priority is distinct from old.priority then
    raise exception 'Only an Owner or Admin can change priority';
  end if;
  if new.post_date is distinct from old.post_date then
    raise exception 'Only an Owner or Admin can set the post date';
  end if;

  if v_role = 'copywriter' then
    if new.assigned_editor_id is distinct from old.assigned_editor_id then
      raise exception 'Only an Owner or Admin can assign editors';
    end if;
    if new.variants_override is distinct from old.variants_override then
      raise exception 'Only an Owner or Admin can override variant routing';
    end if;
    if new.status is distinct from old.status
       and new.status not in ('ideation', 'scripting', 'script_review') then
      raise exception 'A copywriter can move a script between Idea, Scripting and Script Review — approving it for filming is the client''s call';
    end if;
    return new;
  end if;

  -- editors (and any other non-manager seat)
  if new.assigned_editor_id is distinct from old.assigned_editor_id
     and new.assigned_editor_id is not null
     and new.assigned_editor_id <> auth.uid() then
    raise exception 'Editors can only assign a video to themselves';
  end if;
  if new.status is distinct from old.status
     and new.status in ('approved', 'posted', 'ready_to_post', 'final_review',
                        'ideation', 'scripting', 'script_review', 'script_revisions',
                        'needs_creatives', 'creative_review', 'creative_revisions',
                        'ready_to_film', 'editor_brief')
     -- Handing the finished variants over is the editor's own step.
     and not (old.status = 'awaiting_variants' and new.status = 'final_review') then
    raise exception 'Only an Owner or Admin can move a video to %', new.status;
  end if;
  if new.script_hooks is distinct from old.script_hooks
     or new.script_body is distinct from old.script_body
     or new.script_cta is distinct from old.script_cta
     or new.variants_override is distinct from old.variants_override then
    raise exception 'Only an Owner or Admin can edit the script';
  end if;
  return new;
end;
$$;

-- 3 ---------------------------------------------------------------------------
alter table public.trial_posts drop constraint if exists trial_posts_post_as_check;
alter table public.trial_posts
  add constraint trial_posts_post_as_check check (post_as in ('trial', 'main', 'none'));
alter table public.trial_posts alter column post_as set default 'none';
alter table public.trial_posts add column if not exists sent_to_va_at timestamptz;

-- 4 ---------------------------------------------------------------------------
create table if not exists public.script_comments (
  id          uuid primary key default gen_random_uuid(),
  video_id    uuid not null references public.videos (id) on delete cascade,
  -- What it's about: 'hook:0', 'hook:1', 'body', 'cta', 'slide:<slide id>' or 'general'.
  target      text not null default 'general',
  -- The words the comment was made on, so it still reads if the script moves.
  quote       text,
  body        text not null,
  author_id   uuid references public.profiles (id) on delete set null,
  resolved    boolean not null default false,
  resolved_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists script_comments_video_idx on public.script_comments (video_id, created_at);

alter table public.script_comments enable row level security;

drop policy if exists script_comments_select on public.script_comments;
create policy script_comments_select on public.script_comments for select
  using (
    public.current_app_role() in ('owner', 'admin', 'copywriter')
    and public.can_see_video(video_id)
  );

drop policy if exists script_comments_insert on public.script_comments;
create policy script_comments_insert on public.script_comments for insert
  with check (
    public.current_app_role() in ('owner', 'admin', 'copywriter')
    and public.can_see_video(video_id)
    and author_id = auth.uid()
  );

drop policy if exists script_comments_update on public.script_comments;
create policy script_comments_update on public.script_comments for update
  using (
    public.current_app_role() in ('owner', 'admin', 'copywriter')
    and public.can_see_video(video_id)
  )
  with check (
    public.current_app_role() in ('owner', 'admin', 'copywriter')
    and public.can_see_video(video_id)
  );

drop policy if exists script_comments_delete on public.script_comments;
create policy script_comments_delete on public.script_comments for delete
  using (author_id = auth.uid() or public.is_owner_or_admin());

grant select, insert, update, delete on public.script_comments to authenticated;
grant all on public.script_comments to service_role;

-- ----- migration_036_client_name.sql -----
-- Migration 036: the client's name, for copy aimed at the team.
--
-- "Ask Adam to connect Instagram" reads like a person; "ask the owner" reads
-- like a ticket system. Set in Settings -> Branding beside the workspace name,
-- so handing the dashboard to a different client is a settings change.

alter table public.workspace_settings add column if not exists client_name text;

-- ----- migration_037_cut_originals.sql -----
-- Migration 037: keep the original of every uploaded cut.
--
-- Cloudflare Stream re-encodes whatever it's given for playback, and the MP4 it
-- offers for download is that re-encode (a 48 MB upload came back as 6.6 MB).
-- That's fine for reviewing a cut, and wrong for anything that gets posted or
-- archived. So the untouched file is stored alongside: first in Supabase
-- Storage, then mirrored to Drive (and the Storage copy removed), the same way
-- raw footage already works. These columns say where it is.

alter table public.cut_versions
  add column if not exists original_path text,
  add column if not exists original_drive_url text,
  add column if not exists original_name text,
  add column if not exists original_bytes bigint;

-- ----- migration_038_drive_folder_url.sql -----
-- Link to the video's own folder in the Drive archive (<month>/<title>/).
alter table public.videos add column if not exists drive_folder_url text;

-- ----- migration_039_post_caption.sql -----
-- The video's shared caption: written once in the owner's Post tab, used by
-- every variant that doesn't have a caption of its own (including on the VA's desk).
alter table public.videos add column if not exists post_caption text;

-- ----- migration_040_with_va_status.sql -----
-- Migration 040
--
-- A video that has been handed to the VA gets its own stage, 'with_va', between
-- Ready to Post and Posted. Sending to the VA moves it there; the VA can send it
-- back (to Final Review) and the client can take it back (to Ready to Post);
-- when the VA posts it, it goes to Posted and into the archive.
-- Safe to re-run.

alter table public.videos drop constraint if exists videos_status_check;
alter table public.videos add constraint videos_status_check check (status in (
  'ideation', 'scripting', 'script_review', 'script_revisions',
  'needs_creatives', 'creative_review', 'creative_revisions',
  'ready_to_film', 'editor_brief',
  'ready_to_edit', 'in_progress', 'in_review', 'revisions', 'approved',
  'awaiting_variants', 'final_review', 'ready_to_post', 'with_va', 'posted'
));

-- Editors still can't move a video into it.
create or replace function public.videos_guard_columns()
returns trigger
language plpgsql
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    return new;
  end if;
  if public.is_owner_or_admin() then
    return new;
  end if;
  v_role := public.current_app_role();

  if new.priority is distinct from old.priority then
    raise exception 'Only an Owner or Admin can change priority';
  end if;
  if new.post_date is distinct from old.post_date then
    raise exception 'Only an Owner or Admin can set the post date';
  end if;

  if v_role = 'copywriter' then
    if new.assigned_editor_id is distinct from old.assigned_editor_id then
      raise exception 'Only an Owner or Admin can assign editors';
    end if;
    if new.variants_override is distinct from old.variants_override then
      raise exception 'Only an Owner or Admin can override variant routing';
    end if;
    if new.status is distinct from old.status
       and new.status not in ('ideation', 'scripting', 'script_review') then
      raise exception 'A copywriter can move a script between Idea, Scripting and Script Review — approving it for filming is the client''s call';
    end if;
    return new;
  end if;

  -- editors (and any other non-manager seat)
  if new.assigned_editor_id is distinct from old.assigned_editor_id
     and new.assigned_editor_id is not null
     and new.assigned_editor_id <> auth.uid() then
    raise exception 'Editors can only assign a video to themselves';
  end if;
  if new.status is distinct from old.status
     and new.status in ('approved', 'posted', 'ready_to_post', 'with_va', 'final_review',
                        'ideation', 'scripting', 'script_review', 'script_revisions',
                        'needs_creatives', 'creative_review', 'creative_revisions',
                        'ready_to_film', 'editor_brief')
     -- Handing the finished variants over is the editor's own step.
     and not (old.status = 'awaiting_variants' and new.status = 'final_review') then
    raise exception 'Only an Owner or Admin can move a video to %', new.status;
  end if;
  if new.script_hooks is distinct from old.script_hooks
     or new.script_body is distinct from old.script_body
     or new.script_cta is distinct from old.script_cta
     or new.variants_override is distinct from old.variants_override then
    raise exception 'Only an Owner or Admin can edit the script';
  end if;
  return new;
end;
$$;

-- Videos already handed to the VA move across.
update public.videos v
   set status = 'with_va'
 where v.status = 'ready_to_post'
   and exists (
     select 1 from public.trial_posts t
      where t.video_id = v.id
        and t.status in ('planned', 'promoted')
        and t.sent_to_va_at is not null
   );

-- ----- migration_041_variant_cover.sql -----
-- Each variant can have its own cover; the video-wide cover is the fallback.
alter table public.trial_posts add column if not exists cover_path text;

-- ----- migration_042_close_self_signup.sql -----
-- Migration 042: close the self-signup hole.
--
-- Before this, `handle_new_user()` created a profile for ANY new login and copied
-- the role from `raw_user_meta_data` — which the person signing up controls. With
-- Supabase's public sign-up switched on (the default), anyone who had the site's
-- public API key could register themselves as an admin and read the workspace.
--
-- Now a profile is only created for logins made through the dashboard's own admin
-- API, which marks them in `raw_app_meta_data` (server-side only; a browser cannot
-- set it). A self-registered account gets no profile, so it has no role and RLS
-- shows it nothing. Existing seats are untouched (their profile rows already exist).
-- Safe to re-run.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  -- Not created by the dashboard's admin API -> no profile, no access.
  if coalesce(new.raw_app_meta_data ->> 'invited', '') <> 'true' then
    return new;
  end if;

  v_role := coalesce(new.raw_app_meta_data ->> 'role', 'editor');
  if v_role not in ('owner', 'admin', 'editor', 'copywriter', 'va') then
    v_role := 'editor';
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    v_role
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Supabase's admin API creates the login first and writes app_metadata a moment
-- later, so the trigger must also run when app_metadata is set — otherwise a
-- legitimate invite would get no profile.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of raw_app_meta_data on auth.users
  for each row execute function public.handle_new_user();

-- ----- migration_043_tighten_reads.sql -----
-- Migration 043: three lookup tables were readable by ANY logged-in account, including
-- one with no seat in this workspace. Require a seat (any role) instead.
-- Safe to re-run.

drop policy if exists broll_select on public.broll_categories;
create policy broll_select on public.broll_categories for select
  using (public.current_app_role() is not null);

drop policy if exists cadence_select on public.cadence_slots;
create policy cadence_select on public.cadence_slots for select
  using (public.current_app_role() is not null);

drop policy if exists series_read on public.series;
create policy series_read on public.series for select
  using (public.current_app_role() is not null);

-- ----- migration_044_publer.sql -----
-- Publer as a posting channel: post and schedule Reels (including trial reels)
-- from the dashboard through the client's own Publer account.
--
-- The API key is a secret and lives in workspace_settings (Owner-only via RLS,
-- read server-side with the service role). Nothing here is sent to the browser.
--
-- Safe to re-run.

alter table public.workspace_settings
  add column if not exists publer_api_key       text,
  add column if not exists publer_workspace_id  text,
  add column if not exists publer_account_id    text,
  add column if not exists publer_account_name  text,
  -- What a trial reel does after posting. MANUAL: stays a trial until promoted.
  -- SS_PERFORMANCE: Instagram may share it to followers itself if it does well.
  add column if not exists publer_trial_mode    text not null default 'MANUAL'
    check (publer_trial_mode in ('MANUAL', 'SS_PERFORMANCE'));

alter table public.publish_jobs
  -- Posted as an Instagram trial reel (Publer only).
  add column if not exists as_trial       boolean not null default false,
  -- Which route actually carried it: 'instagram' (Graph API) or 'publer'.
  add column if not exists provider       text,
  add column if not exists publer_job_id  text,
  add column if not exists permalink      text;
