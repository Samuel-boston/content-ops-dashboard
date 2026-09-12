-- ===========================================================================
-- Migration 008 — two fixes to the approval routing added in 006
--
-- 1. `needs_variants` is a GENERATED column, and Postgres computes generated
--    columns *after* BEFORE triggers run — so `new.needs_variants` was always
--    NULL inside videos_route_stage(), and every approval fell through to
--    ready_to_post, skipping Awaiting Variants entirely. Derive it from the
--    source columns instead.
--
-- 2. Trigger order let editors past the guard. t15_route_stage ran *before*
--    t20_guard_columns, so an editor setting status='approved' had it rewritten
--    to 'awaiting_variants' before the guard looked — and awaiting_variants
--    isn't on the guard's blocklist, so the approval went through. Renaming the
--    routing trigger to t25 puts it after the guard, which now sees the raw
--    'approved' and refuses it.
-- Safe to re-run.
-- ===========================================================================

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
      new.status := case when v_needs_variants then 'awaiting_variants' else 'ready_to_post' end;
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

-- Re-register after the guard (t20) rather than before it.
drop trigger if exists t15_videos_route_stage on public.videos;
drop trigger if exists t25_videos_route_stage on public.videos;
create trigger t25_videos_route_stage
  before update on public.videos
  for each row execute function public.videos_route_stage();
