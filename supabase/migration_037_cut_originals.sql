-- Migration 037: keep the original of every uploaded cut.
--
-- Cloudflare Stream re-encodes whatever it's given for playback, and the MP4 it
-- offers for download is that re-encode (a 48 MB upload came back as 6.6 MB).
-- That's fine for reviewing a cut, and wrong for anything that gets posted or
-- archived. So the untouched file is stored alongside: first in Supabase
-- Storage, then mirrored to Drive (and the Storage copy removed), the same way
-- raw footage already works. These columns say where it is.

alter table public.cut_versions
  add column if not exists original_path text,
  add column if not exists original_drive_url text,
  add column if not exists original_name text,
  add column if not exists original_bytes bigint;
