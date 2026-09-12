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
