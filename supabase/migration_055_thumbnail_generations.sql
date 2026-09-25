-- Migration 055 — a ledger of ChatGPT thumbnail designs, so the server can cap
-- how many are made per hour and per day. Each design spends the owner's OpenAI
-- credits. Only the server (service role) reads or writes it.
-- Safe to re-run.

create table if not exists public.thumbnail_generations (
  id         uuid primary key default gen_random_uuid(),
  video_id   uuid references public.videos (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists thumbnail_generations_created_idx on public.thumbnail_generations (created_at desc);
create index if not exists thumbnail_generations_user_idx on public.thumbnail_generations (created_by, created_at desc);

alter table public.thumbnail_generations enable row level security;
-- No policies: nobody but the service role can touch it.
grant all on public.thumbnail_generations to service_role;
