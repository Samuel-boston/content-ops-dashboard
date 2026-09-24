-- Migration 042: close the self-signup hole.
--
-- Before this, `handle_new_user()` created a profile for ANY new login and copied
-- the role from `raw_user_meta_data` — which the person signing up controls. With
-- Supabase's public sign-up switched on (the default), anyone who had the site's
-- public API key could register themselves as an admin and read the workspace.
--
-- Now a profile is only created for logins made through the dashboard's own admin
-- API, which marks them in `raw_app_meta_data` (server-side only; a browser cannot
-- set it). A self-registered account gets no profile, so it has no role and RLS
-- shows it nothing. Existing seats are untouched (their profile rows already exist).
-- Safe to re-run.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  -- Not created by the dashboard's admin API -> no profile, no access.
  if coalesce(new.raw_app_meta_data ->> 'invited', '') <> 'true' then
    return new;
  end if;

  v_role := coalesce(new.raw_app_meta_data ->> 'role', 'editor');
  if v_role not in ('owner', 'admin', 'editor', 'copywriter', 'va') then
    v_role := 'editor';
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    v_role
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Supabase's admin API creates the login first and writes app_metadata a moment
-- later, so the trigger must also run when app_metadata is set — otherwise a
-- legitimate invite would get no profile.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of raw_app_meta_data on auth.users
  for each row execute function public.handle_new_user();
