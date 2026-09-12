-- 014 — the editor's side of the product.
--
-- Until now the editors had a queue and not much else: no sense of what a
-- month had earned them, nowhere to put their payment details, and no route
-- to the client's b-roll. This adds the three things that were missing.

-- 1. B-roll library ----------------------------------------------------------
--
-- The footage itself stays on the client's Google Drive — moving fifty
-- categories of raw video into Supabase would cost more per month than the
-- rest of the product combined. What lives here is the index: a name and a
-- share link per category, so an editor finds the right folder without asking.

create table if not exists public.broll_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Null until someone pastes the Drive share link for this folder.
  drive_url text,
  note text,
  position integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists broll_categories_name_key
  on public.broll_categories (lower(name));
create index if not exists broll_categories_position_idx
  on public.broll_categories (position, name);

comment on table public.broll_categories is
  'Index of the client''s Google Drive b-roll folders. Names and share links '
  'only — the media never enters this system.';

-- 2. How an editor gets paid -------------------------------------------------
--
-- A separate table rather than columns on `profiles`, because every signed-in
-- user can read `profiles` — that's what renders names and avatars. Payment
-- details on that row would be readable by every other editor. Here the
-- policies below can be strict: yours, or the owner's view of everyone's.

create table if not exists public.editor_payment_details (
  editor_id uuid primary key references public.profiles (id) on delete cascade,
  -- Free text rather than a validated URL: people get paid by Wise link, by
  -- PayPal.me, by bank details in a note. Prescribing a format here would
  -- just push the real answer into `note`.
  payment_link text,
  note text,
  updated_at timestamptz not null default now()
);

comment on table public.editor_payment_details is
  'Where each editor wants to be paid. Set by them, read by the owner when '
  'settling a month. Admins never see it.';

alter table public.editor_payment_details enable row level security;

drop policy if exists payment_details_own on public.editor_payment_details;
create policy payment_details_own on public.editor_payment_details for all
  using (editor_id = auth.uid())
  with check (editor_id = auth.uid());

-- The owner settles the invoices, so the owner can read them. Deliberately
-- not `is_owner_or_admin()` — admins have no business with payment details.
drop policy if exists payment_details_owner_read on public.editor_payment_details;
create policy payment_details_owner_read on public.editor_payment_details for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'owner'
    )
  );

grant select, insert, update, delete on public.editor_payment_details to authenticated;
grant all on public.editor_payment_details to service_role;

-- 3. RLS + grants ------------------------------------------------------------

alter table public.broll_categories enable row level security;

-- Everyone signed in can browse the library; only the client curates it.
drop policy if exists broll_select on public.broll_categories;
create policy broll_select on public.broll_categories for select
  using (auth.uid() is not null);

drop policy if exists broll_write on public.broll_categories;
create policy broll_write on public.broll_categories for all
  using (public.is_owner_or_admin())
  with check (public.is_owner_or_admin());

-- RLS is only reached once table privileges pass.
grant select, insert, update, delete on public.broll_categories to authenticated;
grant all on public.broll_categories to service_role;
