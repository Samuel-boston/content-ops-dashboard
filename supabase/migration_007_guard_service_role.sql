-- ===========================================================================
-- Migration 007 — let trusted server-side code past the column guard
--
-- videos_guard_columns() rejects anything is_owner_or_admin() doesn't approve,
-- and that resolves through auth.uid(). The service-role client has no
-- auth.uid(), so every server-side status change was being refused:
-- runPublishJob's "-> posted", the Stream→Drive archive, and the Telegram
-- automations all hit "Only an Owner or Admin can move a video to posted".
--
-- The service role already bypasses RLS by design and is only reachable from
-- our own server code, so it belongs on the same side of this guard.
-- Safe to re-run.
-- ===========================================================================

create or replace function public.videos_guard_columns()
returns trigger
language plpgsql
as $$
begin
  -- No JWT = service_role (cron, webhooks, automations, seed scripts). Trusted
  -- server-side callers; RLS never applied to them either.
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
     and new.status in ('approved', 'posted', 'ready_to_post',
                        'final_review', 'ideation', 'scripting') then
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
