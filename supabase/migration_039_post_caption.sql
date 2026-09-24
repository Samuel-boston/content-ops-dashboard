-- The video's shared caption: written once in the owner's Post tab, used by
-- every variant that doesn't have a caption of its own (including on the VA's desk).
alter table public.videos add column if not exists post_caption text;
