-- Link to the video's own folder in the Drive archive (<month>/<title>/).
alter table public.videos add column if not exists drive_folder_url text;
