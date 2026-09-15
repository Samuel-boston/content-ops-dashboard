-- ===========================================================================
-- Migration 027 — Copywriter + VA seats, and the Script Review stage
--
-- The client is bringing on a copywriter and a VA, and neither fits the
-- existing three roles:
--
--   · A COPYWRITER lives entirely in the planning half of the pipeline. They
--     work ideas into scripts and hand them to the client for sign-off. They
--     must see and edit ideation/scripting material — which editors, by
--     design, cannot even see — while never touching priority, assignment,
--     posting, analytics or money.
--   · A VA does the posting (above all, trial reels — which Instagram's API
--     cannot post or read, so they are posted by hand from the app). The VA
--     gets NO row access here at all: their surface is served by service-role
--     server actions that hand-pick fields, the same pattern the MCP and
--     guest-link layers already use. RLS-wise a VA is a member of the org
--     (is_staff — so names, taxonomy, SOP resolve) and nothing more.
--
-- The copywriter also needs a finer scripting flow than one "Scripting"
-- stage. New status `script_review` sits between scripting and ready_to_film:
--
--   ideation ("Idea") → scripting ("Ready to Script" / being written)
--     → script_review ("Ready for Review") → [client approves]
--     → ready_to_film ("Script to Record")
--
-- Same pattern as migrations 009/022 (which added stages): widen the CHECK,
-- re-issue the editor SELECT policy, re-create the guard function. Plus the
-- role plumbing: profiles CHECK, is_staff(), can_see_video(), and copywriter
-- policies on videos + hook_snippets.
-- Safe to re-run.
-- ===========================================================================

-- 1. Roles ------------------------------------------------------------------

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner', 'admin', 'editor', 'copywriter', 'va'));

-- "Staff" means any active seat of the workspace. It gates org-wide reads
-- (profile names, taxonomy, SOP, music/reference libraries) — all of which a
-- copywriter needs and none of which are sensitive to a VA.
create or replace function public.is_staff()
returns boolean
language sql
stable
as $$
  select public.current_app_role() in ('owner', 'admin', 'editor', 'copywriter', 'va')
$$;

-- 2. The Script Review stage --------------------------------------------------

alter table public.videos drop constraint if exists videos_status_check;
alter table public.videos add constraint videos_status_check check (status in (
  'ideation', 'scripting', 'script_review', 'ready_to_film', 'editor_brief',
  'ready_to_edit', 'in_progress', 'in_review', 'revisions', 'approved',
  'awaiting_variants', 'final_review', 'ready_to_post', 'posted'
));

-- Editors: planning stages stay invisible, now including script_review.
drop policy if exists videos_select_editor on public.videos;
create policy videos_select_editor on public.videos for select using (
  public.current_app_role() = 'editor'
  and status not in ('ideation', 'scripting', 'script_review', 'ready_to_film', 'editor_brief')
  and (assigned_editor_id = auth.uid() or status = 'ready_to_edit')
);

-- 3. Copywriter row access on videos ----------------------------------------
-- They see the planning half only: everything up to and including Ready to
-- Film (so an approved "Script to Record" stays visible to its author), and
-- nothing from the editing/posting half — no assignment state, no metrics,
-- and prices are only ever stamped at Posted, which they never see.

drop policy if exists videos_select_copywriter on public.videos;
create policy videos_select_copywriter on public.videos for select using (
  public.current_app_role() = 'copywriter'
  and status in ('ideation', 'scripting', 'script_review', 'ready_to_film')
);

-- New ideas start in the planning stages; a copywriter can seed them.
drop policy if exists videos_insert_copywriter on public.videos;
create policy videos_insert_copywriter on public.videos for insert with check (
  public.current_app_role() = 'copywriter'
  and status in ('ideation', 'scripting')
);

-- Edits allowed while the row stays in the planning half, both before and
-- after the write (so they can never move something INTO the editing half —
-- the guard trigger below narrows the allowed moves further).
drop policy if exists videos_update_copywriter on public.videos;
create policy videos_update_copywriter on public.videos for update
  using (
    public.current_app_role() = 'copywriter'
    and status in ('ideation', 'scripting', 'script_review', 'ready_to_film')
  )
  with check (
    public.current_app_role() = 'copywriter'
    and status in ('ideation', 'scripting', 'script_review', 'ready_to_film')
  );

-- can_see_video() mirrors the videos SELECT policies; every child table
-- (comments, assets, references, carousel slides, messages) delegates to it,
-- which is exactly how the copywriter inherits access to planning material.
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
            and v.status in ('ideation', 'scripting', 'script_review', 'ready_to_film'))
      )
  )
$$;

-- 4. Column/stage guard, now with a copywriter branch -------------------------
-- Editors keep their existing rules (script fields locked, planning stages
-- unreachable — script_review joins that blocklist). Copywriters are the
-- inverse: script fields are their job, but priority / post date / assignment
-- / variant routing stay management calls, and the only stages they may set
-- are the scripting trio — Ready to Film is the client's approval to give.
create or replace function public.videos_guard_columns()
returns trigger
language plpgsql
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    return new;
  end if;
  if public.is_owner_or_admin() then
    return new;
  end if;
  v_role := public.current_app_role();

  if new.priority is distinct from old.priority then
    raise exception 'Only an Owner or Admin can change priority';
  end if;
  if new.post_date is distinct from old.post_date then
    raise exception 'Only an Owner or Admin can set the post date';
  end if;

  if v_role = 'copywriter' then
    if new.assigned_editor_id is distinct from old.assigned_editor_id then
      raise exception 'Only an Owner or Admin can assign editors';
    end if;
    if new.variants_override is distinct from old.variants_override then
      raise exception 'Only an Owner or Admin can override variant routing';
    end if;
    if new.status is distinct from old.status
       and new.status not in ('ideation', 'scripting', 'script_review') then
      raise exception 'A copywriter can move a script between Idea, Scripting and Script Review — approving it for filming is the client''s call';
    end if;
    return new;
  end if;

  -- editors (and any other non-manager seat)
  if new.assigned_editor_id is distinct from old.assigned_editor_id
     and new.assigned_editor_id is not null
     and new.assigned_editor_id <> auth.uid() then
    raise exception 'Editors can only assign a video to themselves';
  end if;
  if new.status is distinct from old.status
     and new.status in ('approved', 'posted', 'ready_to_post', 'final_review',
                        'ideation', 'scripting', 'script_review', 'ready_to_film',
                        'editor_brief') then
    raise exception 'Only an Owner or Admin can move a video to %', new.status;
  end if;
  if new.script_hooks is distinct from old.script_hooks
     or new.script_body is distinct from old.script_body
     or new.script_cta is distinct from old.script_cta
     or new.variants_override is distinct from old.variants_override then
    raise exception 'Only an Owner or Admin can edit the script';
  end if;
  return new;
end;
$$;

-- 5. Hook Library opens to the copywriter -------------------------------------
-- Curating reusable hooks is scriptwriting work. Delete stays management-only
-- (dropping a proven hook is a bigger call than adding one).
drop policy if exists hook_snippets_all on public.hook_snippets;
create policy hook_snippets_all on public.hook_snippets for all
  using (public.is_owner_or_admin())
  with check (public.is_owner_or_admin());
drop policy if exists hook_snippets_copywriter_select on public.hook_snippets;
create policy hook_snippets_copywriter_select on public.hook_snippets for select
  using (public.current_app_role() = 'copywriter');
drop policy if exists hook_snippets_copywriter_insert on public.hook_snippets;
create policy hook_snippets_copywriter_insert on public.hook_snippets for insert
  with check (public.current_app_role() = 'copywriter');
drop policy if exists hook_snippets_copywriter_update on public.hook_snippets;
create policy hook_snippets_copywriter_update on public.hook_snippets for update
  using (public.current_app_role() = 'copywriter')
  with check (public.current_app_role() = 'copywriter');

-- Safe to re-run.
