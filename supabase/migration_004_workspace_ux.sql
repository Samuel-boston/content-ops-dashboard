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
