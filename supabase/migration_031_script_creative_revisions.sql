-- ===========================================================================
-- Migration 031 — Script Revisions, and a real Creative Review stage for carousels
--
-- Two gaps surfaced once the carousel pipeline (migration 030-era work) and
-- the copywriter/client split (migration 027) were actually used side by
-- side:
--
--   1. Sending a script back had no stage of its own — the client's only
--      option was to leave a comment and hope, or silently move it back to
--      'scripting', which looks identical to "never been reviewed yet". New
--      'script_revisions' status, same shape as the existing post-edit
--      'revisions' status: client sends it back from Script Review, the
--      copywriter (or the client themselves) resubmits to Script Review.
--
--   2. A carousel's Script Review approval used to jump straight to Ready
--      to Post — but the generated/selected IMAGES never got a review step
--      of their own, only the caption text did. New 'creative_review'
--      (images made, awaiting approval) and 'creative_revisions' (images
--      need another pass) — approving a script now lands here instead of
--      Ready to Post directly.
--
-- Same pattern as every stage-adding migration before this one: widen the
-- CHECK, re-issue the editor/copywriter SELECT policies, re-create the
-- guard function. Safe to re-run.
-- ===========================================================================

alter table public.videos drop constraint if exists videos_status_check;
alter table public.videos add constraint videos_status_check check (status in (
  'ideation', 'scripting', 'script_review', 'script_revisions',
  'creative_review', 'creative_revisions',
  'ready_to_film', 'editor_brief',
  'ready_to_edit', 'in_progress', 'in_review', 'revisions', 'approved',
  'awaiting_variants', 'final_review', 'ready_to_post', 'posted'
));

-- Editors: planning stages (now including script_revisions) stay invisible.
-- creative_review/creative_revisions are carousel-only and, structurally, an
-- editor's second AND-condition (assigned_editor_id / ready_to_edit) already
-- excludes every carousel row — listed here too for the same reason the
-- others are: a reader shouldn't have to know that to trust the list.
drop policy if exists videos_select_editor on public.videos;
create policy videos_select_editor on public.videos for select using (
  public.current_app_role() = 'editor'
  and status not in (
    'ideation', 'scripting', 'script_review', 'script_revisions',
    'creative_review', 'creative_revisions', 'ready_to_film', 'editor_brief'
  )
  and (assigned_editor_id = auth.uid() or status = 'ready_to_edit')
);

-- Copywriter: script_revisions joins the planning half they can see and
-- edit — a script sent back for changes is exactly their job. Creative
-- review is the client's call past this point, so it's deliberately NOT
-- added here.
drop policy if exists videos_select_copywriter on public.videos;
create policy videos_select_copywriter on public.videos for select using (
  public.current_app_role() = 'copywriter'
  and status in ('ideation', 'scripting', 'script_review', 'script_revisions', 'ready_to_film')
);

drop policy if exists videos_update_copywriter on public.videos;
create policy videos_update_copywriter on public.videos for update
  using (
    public.current_app_role() = 'copywriter'
    and status in ('ideation', 'scripting', 'script_review', 'script_revisions', 'ready_to_film')
  )
  with check (
    public.current_app_role() = 'copywriter'
    and status in ('ideation', 'scripting', 'script_review', 'script_revisions', 'ready_to_film')
  );

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
            and v.status in ('ideation', 'scripting', 'script_review', 'script_revisions', 'ready_to_film'))
      )
  )
$$;

-- Guard function: only the status blocklists changed (script_revisions,
-- creative_review, creative_revisions all join the "manager-only" set for
-- editors — a copywriter was never allowed past script_review anyway, so
-- their branch is unchanged).
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
                        'ideation', 'scripting', 'script_review', 'script_revisions',
                        'creative_review', 'creative_revisions',
                        'ready_to_film', 'editor_brief') then
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

-- Safe to re-run.
