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
