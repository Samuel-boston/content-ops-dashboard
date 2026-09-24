-- Migration 035
--
--  1. 'needs_creatives' — a carousel whose script is approved lands here (the
--     images still have to be made), then goes to Creative Review.
--  2. Editors may submit hook variants: awaiting_variants -> final_review was
--     blocked by the guard ("Only an Owner or Admin can move a video to
--     final_review"), but handing the variants over is the editor's whole job.
--  3. trial_posts becomes the per-variant record: post_as gains 'none' (not
--     selected yet, the new default) and sent_to_va_at marks what's actually
--     been handed to the VA — variants can now exist as drafts without the VA
--     seeing them.
--  4. script_comments — comments on specific parts of a script (a hook, the
--     body, the call to action, a carousel slide), written by the client and
--     answered by the copywriter.
-- Safe to re-run.

-- 1 ---------------------------------------------------------------------------
alter table public.videos drop constraint if exists videos_status_check;
alter table public.videos add constraint videos_status_check check (status in (
  'ideation', 'scripting', 'script_review', 'script_revisions',
  'needs_creatives', 'creative_review', 'creative_revisions',
  'ready_to_film', 'editor_brief',
  'ready_to_edit', 'in_progress', 'in_review', 'revisions', 'approved',
  'awaiting_variants', 'final_review', 'ready_to_post', 'posted'
));

drop policy if exists videos_select_editor on public.videos;
create policy videos_select_editor on public.videos for select using (
  public.current_app_role() = 'editor'
  and status not in (
    'ideation', 'scripting', 'script_review', 'script_revisions',
    'needs_creatives', 'creative_review', 'creative_revisions',
    'ready_to_film', 'editor_brief'
  )
  and (assigned_editor_id = auth.uid() or status = 'ready_to_edit')
);

-- 2 ---------------------------------------------------------------------------
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

-- 3 ---------------------------------------------------------------------------
alter table public.trial_posts drop constraint if exists trial_posts_post_as_check;
alter table public.trial_posts
  add constraint trial_posts_post_as_check check (post_as in ('trial', 'main', 'none'));
alter table public.trial_posts alter column post_as set default 'none';
alter table public.trial_posts add column if not exists sent_to_va_at timestamptz;

-- 4 ---------------------------------------------------------------------------
create table if not exists public.script_comments (
  id          uuid primary key default gen_random_uuid(),
  video_id    uuid not null references public.videos (id) on delete cascade,
  -- What it's about: 'hook:0', 'hook:1', 'body', 'cta', 'slide:<slide id>' or 'general'.
  target      text not null default 'general',
  -- The words the comment was made on, so it still reads if the script moves.
  quote       text,
  body        text not null,
  author_id   uuid references public.profiles (id) on delete set null,
  resolved    boolean not null default false,
  resolved_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists script_comments_video_idx on public.script_comments (video_id, created_at);

alter table public.script_comments enable row level security;

drop policy if exists script_comments_select on public.script_comments;
create policy script_comments_select on public.script_comments for select
  using (
    public.current_app_role() in ('owner', 'admin', 'copywriter')
    and public.can_see_video(video_id)
  );

drop policy if exists script_comments_insert on public.script_comments;
create policy script_comments_insert on public.script_comments for insert
  with check (
    public.current_app_role() in ('owner', 'admin', 'copywriter')
    and public.can_see_video(video_id)
    and author_id = auth.uid()
  );

drop policy if exists script_comments_update on public.script_comments;
create policy script_comments_update on public.script_comments for update
  using (
    public.current_app_role() in ('owner', 'admin', 'copywriter')
    and public.can_see_video(video_id)
  )
  with check (
    public.current_app_role() in ('owner', 'admin', 'copywriter')
    and public.can_see_video(video_id)
  );

drop policy if exists script_comments_delete on public.script_comments;
create policy script_comments_delete on public.script_comments for delete
  using (author_id = auth.uid() or public.is_owner_or_admin());

grant select, insert, update, delete on public.script_comments to authenticated;
grant all on public.script_comments to service_role;
