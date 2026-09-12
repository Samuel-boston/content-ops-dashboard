-- ===========================================================================
-- Migration 006 — full pipeline, ETAs, hook-variant routing, editor pricing
--
--   ideation → scripting → ready_to_edit → in_progress → in_review
--     → revisions ⇄ in_review → approved
--     → (needs variants ? awaiting_variants → final_review : —) → ready_to_post
--     → posted
--
-- ideation and scripting are client-side only; editors never see them.
-- `approved` is a decision, not a resting state: a trigger immediately routes
-- it onward, so no video ever sits in it.
-- Safe to re-run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Statuses
-- ---------------------------------------------------------------------------

alter table public.videos drop constraint if exists videos_status_check;
alter table public.videos add constraint videos_status_check check (status in (
  'ideation', 'scripting', 'ready_to_edit', 'in_progress', 'in_review',
  'revisions', 'approved', 'awaiting_variants', 'final_review',
  'ready_to_post', 'posted'
));

-- priority_rank already exists; extend the board ordering index to the new set.
drop index if exists public.videos_board_order_idx;
create index videos_board_order_idx
  on public.videos (status, board_position nulls last, priority_rank desc, created_at);

-- ---------------------------------------------------------------------------
-- 2. ETAs, variant intent, spoken brief, price snapshot
-- ---------------------------------------------------------------------------

alter table public.videos
  -- The editor's promised delivery for the stage they're currently in.
  -- eta_stage records which stage it was given for, so an edit ETA isn't
  -- mistaken for a revisions ETA after the video moves on.
  add column if not exists eta_at timestamptz,
  add column if not exists eta_stage text,
  add column if not exists eta_set_by uuid references public.profiles (id) on delete set null,
  add column if not exists eta_set_at timestamptz,

  -- Hook variants. Normally derived from the script: more than one hook in
  -- script_hooks means variants are wanted. The client can force it either way
  -- at approval, which is what this override records (null = derive).
  add column if not exists variants_override boolean,

  -- Spoken brief recorded by the client, in the `comment-media` bucket.
  add column if not exists brief_voice_path text,
  add column if not exists brief_voice_duration_seconds numeric,
  add column if not exists brief_voice_peaks jsonb,

  -- Price snapshot, taken when the video is posted so later rate changes
  -- never rewrite what an editor already earned.
  add column if not exists price_cents integer,
  add column if not exists price_breakdown jsonb,
  add column if not exists priced_at timestamptz;

-- Generated so it can be filtered and indexed, and can never drift from the
-- script it's derived from.
alter table public.videos drop column if exists needs_variants;
alter table public.videos add column needs_variants boolean
  generated always as (
    coalesce(variants_override, coalesce(array_length(script_hooks, 1), 0) > 1)
  ) stored;

-- ---------------------------------------------------------------------------
-- 3. Per-editor, per-format pricing
-- ---------------------------------------------------------------------------

create table if not exists public.editor_rates (
  id          uuid primary key default gen_random_uuid(),
  editor_id   uuid not null references public.profiles (id) on delete cascade,
  format      text not null,
  price_cents integer not null default 0 check (price_cents >= 0),
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  unique (editor_id, format)
);

create index if not exists editor_rates_editor_idx on public.editor_rates (editor_id);

-- Surcharge per *extra* hook variant beyond the first, and the display
-- currency. Single-row workspace_settings, Owner-only.
alter table public.workspace_settings
  add column if not exists hook_variant_surcharge_cents integer not null default 200,
  add column if not exists currency text not null default 'USD';

-- ---------------------------------------------------------------------------
-- 4. Pricing helper
-- ---------------------------------------------------------------------------

-- Base rate for the video's first matching format, plus the surcharge for each
-- hook variant after the first ("4 variants = 3 extra"). SECURITY DEFINER so
-- the posting trigger can read rates the acting user may not be allowed to see.
create or replace function public.video_price(p_video_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v            public.videos%rowtype;
  v_base       integer := 0;
  v_format     text;
  v_variants   integer := 0;
  v_surcharge  integer := 200;
  v_extra      integer := 0;
begin
  select * into v from public.videos where id = p_video_id;
  if not found or v.assigned_editor_id is null then
    return jsonb_build_object('total_cents', 0, 'reason', 'no editor assigned');
  end if;

  select coalesce(hook_variant_surcharge_cents, 200) into v_surcharge
    from public.workspace_settings limit 1;

  -- First format that has a rate for this editor.
  select r.format, r.price_cents into v_format, v_base
    from public.editor_rates r
   where r.editor_id = v.assigned_editor_id
     and r.format = any(v.formats)
   order by r.price_cents desc
   limit 1;

  if v_format is null then
    v_base := 0;
  end if;

  -- Delivered hook variants = hook cuts on this video.
  select count(*) into v_variants
    from public.video_cuts c
   where c.video_id = p_video_id and c.kind = 'hook';

  v_extra := greatest(v_variants - 1, 0);

  return jsonb_build_object(
    'total_cents',     coalesce(v_base, 0) + v_extra * v_surcharge,
    'base_cents',      coalesce(v_base, 0),
    'format',          v_format,
    'variants',        v_variants,
    'extra_variants',  v_extra,
    'surcharge_cents', v_surcharge
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Stage machine
-- ---------------------------------------------------------------------------

-- Approval is a decision, not a destination: route it on immediately.
-- Also snapshots the price the moment a video is posted, and clears a stale
-- ETA whenever the stage changes.
create or replace function public.videos_route_stage()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'approved' then
      new.status := case when new.needs_variants then 'awaiting_variants' else 'ready_to_post' end;
    end if;

    -- Once the variants are in and re-checked, the video is ready to go out.
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

drop trigger if exists t15_videos_route_stage on public.videos;
create trigger t15_videos_route_stage
  before update on public.videos
  for each row execute function public.videos_route_stage();

-- Price snapshot runs after the row settles, so it sees the final status.
create or replace function public.videos_price_on_post()
returns trigger
language plpgsql
as $$
declare
  v_price jsonb;
begin
  if new.status = 'posted' and (old.status is distinct from 'posted') and new.price_cents is null then
    v_price := public.video_price(new.id);
    update public.videos
       set price_cents = (v_price->>'total_cents')::int,
           price_breakdown = v_price,
           priced_at = now()
     where id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists t90_videos_price_on_post on public.videos;
create trigger t90_videos_price_on_post
  after update on public.videos
  for each row execute function public.videos_price_on_post();

-- ---------------------------------------------------------------------------
-- 6. Editor write rules — extended for the new stages
-- ---------------------------------------------------------------------------

create or replace function public.videos_guard_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_owner_or_admin() then
    return new;
  end if;

  if new.priority is distinct from old.priority then
    raise exception 'Only an Owner or Admin can change priority';
  end if;

  if new.post_date is distinct from old.post_date then
    raise exception 'Only an Owner or Admin can set the post date';
  end if;

  if new.assigned_editor_id is distinct from old.assigned_editor_id
     and new.assigned_editor_id is not null
     and new.assigned_editor_id <> auth.uid() then
    raise exception 'Editors can only assign a video to themselves';
  end if;

  -- Editors move work forward for review; they never approve it, publish it,
  -- or push it back into the client's private planning stages.
  if new.status is distinct from old.status
     and new.status in ('approved', 'posted', 'ready_to_post',
                        'final_review', 'ideation', 'scripting') then
    raise exception 'Only an Owner or Admin can move a video to %', new.status;
  end if;

  -- The script is the client's. Editors read it, they don't rewrite it.
  if new.script_hooks is distinct from old.script_hooks
     or new.script_body is distinct from old.script_body
     or new.script_cta is distinct from old.script_cta
     or new.variants_override is distinct from old.variants_override then
    raise exception 'Only an Owner or Admin can edit the script';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. RLS — editors never see the client's planning stages
-- ---------------------------------------------------------------------------

drop policy if exists videos_select_editor on public.videos;
create policy videos_select_editor on public.videos for select using (
  public.current_app_role() = 'editor'
  and status not in ('ideation', 'scripting')
  and (assigned_editor_id = auth.uid() or status = 'ready_to_edit')
);

alter table public.editor_rates enable row level security;

-- The owner sets and sees every rate. An editor sees only their own, and can
-- never write one. Admins get nothing — pay is between the client and the
-- editor.
drop policy if exists editor_rates_owner_all on public.editor_rates;
create policy editor_rates_owner_all on public.editor_rates for all
  using (public.current_app_role() = 'owner')
  with check (public.current_app_role() = 'owner');

drop policy if exists editor_rates_select_own on public.editor_rates;
create policy editor_rates_select_own on public.editor_rates for select
  using (editor_id = auth.uid());

grant select, insert, update, delete on public.editor_rates to authenticated;
grant all on all tables in schema public to service_role;
