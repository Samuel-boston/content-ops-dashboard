-- ===========================================================================
-- Migration 011 — storage policies for music, references and footage
--
-- These three buckets were created (migrations 002 and 003) without any
-- policies on storage.objects. RLS is on by default there, so with no policy
-- every object was invisible to normal users: signing a URL failed with
-- "Object not found" even though the file existed. Only `comment-media` ever
-- got policies (migration 004), which is why voice notes worked and music
-- playback, reference images and footage downloads did not.
--
-- Same shape as comment-media: signed-in users may read and write; the app
-- mints short-lived signed URLs and only ever does so for rows the caller can
-- already see through the tables' own RLS.
-- Safe to re-run.
-- ===========================================================================

do $$
declare
  b text;
begin
  foreach b in array array['music', 'references', 'footage'] loop
    execute format('drop policy if exists %I on storage.objects', b || '_select');
    execute format(
      'create policy %I on storage.objects for select to authenticated using (bucket_id = %L)',
      b || '_select', b
    );

    execute format('drop policy if exists %I on storage.objects', b || '_insert');
    execute format(
      'create policy %I on storage.objects for insert to authenticated with check (bucket_id = %L)',
      b || '_insert', b
    );

    execute format('drop policy if exists %I on storage.objects', b || '_update');
    execute format(
      'create policy %I on storage.objects for update to authenticated using (bucket_id = %L) with check (bucket_id = %L)',
      b || '_update', b, b
    );

    execute format('drop policy if exists %I on storage.objects', b || '_delete');
    execute format(
      'create policy %I on storage.objects for delete to authenticated using (bucket_id = %L)',
      b || '_delete', b
    );
  end loop;
end $$;
