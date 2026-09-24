-- Migration 043: three lookup tables were readable by ANY logged-in account, including
-- one with no seat in this workspace. Require a seat (any role) instead.
-- Safe to re-run.

drop policy if exists broll_select on public.broll_categories;
create policy broll_select on public.broll_categories for select
  using (public.current_app_role() is not null);

drop policy if exists cadence_select on public.cadence_slots;
create policy cadence_select on public.cadence_slots for select
  using (public.current_app_role() is not null);

drop policy if exists series_read on public.series;
create policy series_read on public.series for select
  using (public.current_app_role() is not null);
