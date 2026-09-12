# Content Ops Dashboard

A multi-role video content-operations system for a video-editing client —
replacing a Notion pipeline, Frame.io review, and a Google Drive archive with
one dashboard split by role.

Built by NB Creatives. Replaces the earlier single-password `client-dashboard`
for the same client (reuses that Supabase project; the old schema is dropped).

## Stack

- **Next.js 16** (App Router, Turbopack) + Tailwind v4
- **Supabase** — Postgres + **real Supabase Auth** with a `role` column
  (`owner` / `admin` / `editor`) and **RLS policies per role**. Editors are
  scoped at the database to their own assigned videos plus the open Ready to
  Edit pool — not just hidden in the UI.
- Host-agnostic (Vercel or Cloudflare Pages — decided with the client later).

House conventions (from the sibling dashboards): server actions in
`src/app/actions.ts`, a server-only `supabaseAdmin()` for privileged ops, a
request-scoped `supabaseServer()` (RLS-enforced) for everything a user does,
dark neutral theme. Never bind an imported server action straight to
`<form action={fn}>` — always wrap it: `action={(fd) => { await fn(fd); }}`.

## Roles

| Role   | Seats | Can |
| ------ | ----- | --- |
| Owner  | 1     | Everything. Only seat that can add/remove Admins. Workspace settings. |
| Admin  | N     | Full review/comment, manage editors, set priority, analytics. **Cannot** add Admins or touch workspace settings. |
| Editor | N     | Own queue + the open Ready to Edit pool only. All editor seats identical. |

## Pipeline

`Ready to Edit → In Progress → In Review → Revisions → Approved → Posted`

There is **no "Claimed" stage** — assigning an editor is what moves a video to
In Progress (enforced by a DB trigger, both directions). Posted videos leave
the active board and live in the calendar archive.

## One-time setup

1. Copy env and fill in values:

   ```bash
   cp .env.local.example .env.local
   ```

   Needs: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`,
   `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and for
   migrations `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF`.

2. Apply the schema, in order (the first drops the retired old dashboard's tables):

   ```bash
   npm run db:push supabase/schema.sql
   npm run db:push supabase/migration_002_engine_library_analytics.sql
   ```

   Or paste each file into the Supabase SQL editor. `db:push` needs
   `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF`.

3. Seed the first Owner login:

   ```bash
   node scripts/seed.mjs    # uses SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD
   ```

   Set `SEED_PLACEHOLDERS=1` to also create a placeholder Admin + 2 Editors
   for testing all three role views.

4. Run:

   ```bash
   npm install
   npm run dev
   ```

## Moving to the client's own Supabase later

Re-run `supabase/schema.sql` against the new project, re-run `scripts/seed.mjs`
with the client's email as Owner, and swap `SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_SUPABASE_*` on the deployed app.
No data migration — everything from here on is placeholder/example data.

## What's built

All six phases are in the tree. Everything that's pure app + DB runs now;
the external integrations are coded against their real APIs and light up the
moment credentials are added in **Settings → Integrations** (Owner only) —
until then those surfaces show a clear "not connected" state.

1. **Foundation** — roles + RLS, pipeline, Ready to Edit, taxonomy,
   calendar + stage counts, three dashboards, stalled-video flags.
2. **Video engine** — direct-to-Cloudflare-Stream upload (bytes bypass our
   server), HLS scrubbing playback, point + range comments pinned to the
   timeline (threaded, resolvable), version stacking + revert, hook variants
   as full video-engine citizens with their own notes. Per-video chat with
   `@mention` → in-app + email notification. Script (Hook lines / Body / CTA).
3. **Library** — posted archive (auto-moves cut files Stream → Google Drive on
   Posted), music library (free-form categories, search-within-category,
   scales to 200+), reference/inspiration (attached rides the video lifecycle;
   unattached holding area with used/dismiss + 30-day auto-archive), SOP.
4. **Analytics** — Instagram Graph API: per-video stats + account-wide rollup
   filterable by format and date range. No per-editor performance metrics.
5. **Publishing** — queue + schedule; posts approved videos as IG Reels via
   the same Graph connection. Due jobs run from the cron route.
6. **Automations** — `/api/telegram/webhook`: voice note → Whisper → new video
   in Ready to Edit (needs-script flagged); audio file → Music Library
   "Uncategorized"; Ready-to-Edit-hits-zero → "film more" message. Locked to
   authorised chat/user IDs. `/api/cron?key=$CRON_SECRET`: stalled alerts,
   reference auto-archive, due publish jobs, and a Monday weekly report.

### Integration setup, per feature

| Feature | Needs | Where |
| --- | --- | --- |
| Video engine | Cloudflare Stream account + API token | Settings → Integrations |
| Posted → Drive archive | Google Drive folder + service-account JSON | Settings → Integrations |
| Analytics + Publishing | IG Business account + Graph API long-lived token | Settings → Integrations |
| Telegram automations | Bot token + authorised chat IDs; OpenAI key for transcription | Settings → Integrations |
| Email notifications | `RESEND_API_KEY` + `RESEND_FROM_EMAIL` | `.env` |
| Cron | `CRON_SECRET` in `.env`; point a scheduler at `/api/cron?key=…` hourly | host |
