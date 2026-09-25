-- Migration 054 — tidy the variant destinations 046 left behind.
--
-- 046 marked existing Ready-to-Post variants as sent but didn't settle their
-- destination: a carousel row (or any row left on "none") would have shown to
-- the VA as a trial reel, and a long video (YouTube) is always a main post.
-- Safe to re-run.

update public.trial_posts t
   set post_as = case when t.cut_id is null then 'main' else 'trial' end
  from public.videos v
 where v.id = t.video_id and v.status = 'with_va' and t.status = 'planned' and t.post_as = 'none';

update public.trial_posts t
   set post_as = 'main'
  from public.videos v
 where v.id = t.video_id and v.status = 'with_va' and t.status = 'planned' and t.post_as = 'trial'
   and 'Long video' = any (v.formats);
