-- Migration 052 — fix a regression from migration 045.
--
-- 045 redefined can_see_video() to add "anyone mentioned on the video" but started
-- from the original 002 definition, which dropped the copywriter branch added in
-- 027/031. Copywriters lost read access (and chat/comment inserts) on the planning
-- stages' child tables. This restores it, keeping the mention rule.
-- Safe to re-run.

create or replace function public.can_see_video(v_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.videos v
    where v.id = v_id
      and (
        public.is_owner_or_admin()
        or (public.current_app_role() = 'editor'
            and (v.assigned_editor_id = auth.uid() or v.status = 'ready_to_edit'))
        or (public.current_app_role() = 'copywriter'
            and v.status in ('ideation', 'scripting', 'ready_to_film'))
        or public.is_mentioned_on_video(v.id)
      )
  )
$$;
