-- Migration 036: the client's name, for copy aimed at the team.
--
-- "Ask Adam to connect Instagram" reads like a person; "ask the owner" reads
-- like a ticket system. Set in Settings -> Branding beside the workspace name,
-- so handing the dashboard to a different client is a settings change.

alter table public.workspace_settings add column if not exists client_name text;
