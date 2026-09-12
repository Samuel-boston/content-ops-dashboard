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
