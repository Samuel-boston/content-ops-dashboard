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
