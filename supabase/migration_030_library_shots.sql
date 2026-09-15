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
