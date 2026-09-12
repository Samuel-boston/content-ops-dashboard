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
