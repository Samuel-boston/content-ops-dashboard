-- Tagging someone in a video's chat or a timeline comment now lets them open that
-- video. Before, an editor @-mentioned on a video that wasn't theirs and wasn't in
-- the Ready to Edit pool got "Not found" when they clicked the notification.
--
-- Read access only follows the mention; it doesn't give anyone new write rights
-- on the video itself (the update policies are unchanged).
--
-- Safe to re-run.

create or replace function public.is_mentioned_on_video(v_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (
      select 1 from public.video_messages m
      where m.video_id = v_id and auth.uid() = any (m.mentions)
    )
    or exists (
      select 1
      from public.cut_comments c
      join public.video_cuts vc on vc.id = c.cut_id
      where vc.video_id = v_id and auth.uid() = any (c.mentions)
    )
  )
$$;

drop policy if exists videos_select_mentioned on public.videos;
create policy videos_select_mentioned on public.videos
  for select using (public.is_mentioned_on_video(id));

-- Everything that follows a video's visibility (cuts, chat, comments, assets,
-- activity) follows the mention too.
create or replace function public.can_see_video(v_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.videos v
    where v.id = v_id
      and (
        public.is_owner_or_admin()
        or (public.current_app_role() = 'editor'
            and (v.assigned_editor_id = auth.uid() or v.status = 'ready_to_edit'))
        or public.is_mentioned_on_video(v.id)
      )
  )
$$;
