-- ---------------------------------------------------------------------------
-- personal_access_tokens — lets a user connect their own AI assistant (Claude,
-- ChatGPT, etc.) to this workspace as an MCP client. The token authenticates
-- the /api/mcp endpoint; the raw token is shown to the user exactly once at
-- creation time and only its sha-256 hash is ever stored.
-- ---------------------------------------------------------------------------
create table if not exists public.personal_access_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles (id) on delete cascade,
  label       text not null,
  token_hash  text not null unique,
  last_used_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists personal_access_tokens_user_idx on personal_access_tokens (user_id);

alter table public.personal_access_tokens enable row level security;

-- Everyone can see and manage only their own tokens. The /api/mcp endpoint
-- itself resolves tokens with the service-role client, which bypasses RLS.
drop policy if exists "own tokens" on public.personal_access_tokens;
create policy "own tokens" on public.personal_access_tokens
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
