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
