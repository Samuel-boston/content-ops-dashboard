-- Migration 040
--
-- A video that has been handed to the VA gets its own stage, 'with_va', between
-- Ready to Post and Posted. Sending to the VA moves it there; the VA can send it
-- back (to Final Review) and the client can take it back (to Ready to Post);
-- when the VA posts it, it goes to Posted and into the archive.
-- Safe to re-run.

alter table public.videos drop constraint if exists videos_status_check;
alter table public.videos add constraint videos_status_check check (status in (
  'ideation', 'scripting', 'script_review', 'script_revisions',
  'needs_creatives', 'creative_review', 'creative_revisions',
  'ready_to_film', 'editor_brief',
  'ready_to_edit', 'in_progress', 'in_review', 'revisions', 'approved',
  'awaiting_variants', 'final_review', 'ready_to_post', 'with_va', 'posted'
));

-- Editors still can't move a video into it.
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
     and new.status in ('approved', 'posted', 'ready_to_post', 'with_va', 'final_review',
                        'ideation', 'scripting', 'script_review', 'script_revisions',
                        'needs_creatives', 'creative_review', 'creative_revisions',
                        'ready_to_film', 'editor_brief')
     -- Handing the finished variants over is the editor's own step.
     and not (old.status = 'awaiting_variants' and new.status = 'final_review') then
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

-- Videos already handed to the VA move across.
update public.videos v
   set status = 'with_va'
 where v.status = 'ready_to_post'
   and exists (
     select 1 from public.trial_posts t
      where t.video_id = v.id
        and t.status in ('planned', 'promoted')
        and t.sent_to_va_at is not null
   );
