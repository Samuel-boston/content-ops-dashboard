-- ===========================================================================
-- Migration 022 — Editor Brief stage
--
-- A new client-only stage between "Ready to Film" and "Ready to Edit": the
-- assembly step where the brief (voice/written), a screen recording, tagged
-- music and priority all get finished before a video is handed to editors.
-- Same pattern as migration 009's "Ready to Film" addition — no new columns
-- or tables, just widening the status enum and the two places that fence it.
-- Safe to re-run.
-- ===========================================================================

alter table public.videos drop constraint if exists videos_status_check;
alter table public.videos add constraint videos_status_check check (status in (
  'ideation', 'scripting', 'ready_to_film', 'editor_brief', 'ready_to_edit',
  'in_progress', 'in_review', 'revisions', 'approved', 'awaiting_variants',
  'final_review', 'ready_to_post', 'posted'
));

drop policy if exists videos_select_editor on public.videos;
create policy videos_select_editor on public.videos for select using (
  public.current_app_role() = 'editor'
  and status not in ('ideation', 'scripting', 'ready_to_film', 'editor_brief')
  and (assigned_editor_id = auth.uid() or status = 'ready_to_edit')
);

create or replace function public.videos_guard_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if public.is_owner_or_admin() then
    return new;
  end if;
  if new.priority is distinct from old.priority then
    raise exception 'Only an Owner or Admin can change priority';
  end if;
  if new.post_date is distinct from old.post_date then
    raise exception 'Only an Owner or Admin can set the post date';
  end if;
  if new.assigned_editor_id is distinct from old.assigned_editor_id
     and new.assigned_editor_id is not null
     and new.assigned_editor_id <> auth.uid() then
    raise exception 'Editors can only assign a video to themselves';
  end if;
  if new.status is distinct from old.status
     and new.status in ('approved', 'posted', 'ready_to_post', 'final_review',
                        'ideation', 'scripting', 'ready_to_film', 'editor_brief') then
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
