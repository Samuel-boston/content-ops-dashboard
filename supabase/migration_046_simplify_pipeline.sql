-- Migration 046 — a shorter pipeline.
--
--  * Script Review and Script Revisions are gone: a script lives in Scripting.
--  * Creative Revisions is gone: a carousel sent back for another pass returns
--    to Needs Creatives.
--  * Ready to Post is gone: approving the cut (or, when the script had several
--    hooks, approving Final Review) hands the video straight to the VA.
--
-- The old status values stay legal in the CHECK constraint so old rows and
-- rollbacks are harmless, but nothing sets them any more and existing rows are
-- moved out below.
-- Safe to re-run.

-- 1. Approval routes straight to the VA when there are no hook variants to make.
create or replace function public.videos_route_stage()
returns trigger
language plpgsql
as $$
declare
  v_needs_variants boolean;
begin
  if new.status is distinct from old.status then
    if new.status = 'approved' then
      -- Derived here, not read from the generated column, which isn't
      -- populated yet at BEFORE-trigger time.
      v_needs_variants := coalesce(
        new.variants_override,
        coalesce(array_length(new.script_hooks, 1), 0) > 1
      );
      new.status := case when v_needs_variants then 'awaiting_variants' else 'with_va' end;
    end if;

    -- Handed to the VA: stamp when, so their desk can say "sent 2h ago".
    if new.status = 'with_va' and old.status is distinct from 'with_va' then
      new.va_sent_at := coalesce(new.va_sent_at, now());
    end if;

    -- An ETA belongs to the stage it was promised for.
    if new.status is distinct from old.status then
      new.eta_at := null;
      new.eta_stage := null;
      new.eta_set_by := null;
      new.eta_set_at := null;
    end if;
  end if;
  return new;
end;
$$;

-- 2. Move anything sitting in a removed stage.
update public.videos set status = 'scripting' where status in ('script_review', 'script_revisions');
update public.videos set status = 'needs_creatives' where status = 'creative_revisions';

-- Ready to Post: give each video its variant rows (they are otherwise created
-- lazily by the app), then hand it to the VA.
insert into public.trial_posts (video_id, cut_id, label, status, post_as, sent_to_va_at)
select v.id, c.id, c.label, 'planned', 'trial', now()
  from public.videos v
  join public.video_cuts c on c.video_id = v.id
 where v.status = 'ready_to_post'
   and not ('Carousels' = any (v.formats) or 'Carousel with text' = any (v.formats))
   and not exists (
     select 1 from public.trial_posts t
      where t.video_id = v.id and t.cut_id = c.id and t.status <> 'archived'
   );

insert into public.trial_posts (video_id, cut_id, label, status, post_as, sent_to_va_at)
select v.id, null, 'Carousel', 'planned', 'main', now()
  from public.videos v
 where v.status = 'ready_to_post'
   and ('Carousels' = any (v.formats) or 'Carousel with text' = any (v.formats))
   and not exists (
     select 1 from public.trial_posts t
      where t.video_id = v.id and t.cut_id is null and t.status <> 'archived'
   );

update public.trial_posts t
   set sent_to_va_at = coalesce(t.sent_to_va_at, now())
  from public.videos v
 where v.id = t.video_id and v.status = 'ready_to_post' and t.status = 'planned';

update public.videos
   set status = 'with_va', va_sent_at = coalesce(va_sent_at, now())
 where status = 'ready_to_post';
