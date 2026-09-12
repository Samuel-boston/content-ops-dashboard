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
