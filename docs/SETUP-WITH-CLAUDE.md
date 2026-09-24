# Set this up with Claude

This is the fast path. Instead of clicking through every screen, the Owner (Adam) gives one prompt to his own Claude and Claude does the technical work. Adam only does the parts that need a person: logging in, entering a card, and pressing confirm buttons.

Use **Claude Code** (the terminal or the desktop app's Code tab) for the main setup, because it can run commands. Use **Claude in Chrome** for anything that has no command line, such as Cloudflare and Meta.

## What Adam does himself (about 15 minutes, once)

1. Create a **GitHub** account, a **Vercel** account (sign in with GitHub, upgrade to **Pro**) and a **Supabase** account. Use his own email and his own card.
2. In Supabase create a **new project**. Choose a region near the team, set a database password and save it. Then go to **Project Settings → Billing** and upgrade to **Pro** (this turns on daily backups).
3. Install Claude Code and open a terminal in an empty folder.
4. Tell Nathan his GitHub username, so Nathan can give him read access to the code. Nathan removes that access once the copy is made.

Everything below is done by Claude.

## The prompt

Adam pastes this into Claude Code. The text between the lines is the whole prompt.

---

I am setting up my own copy of a content-operations dashboard. The code is in the private GitHub repo `Samuel-boston/content-ops-dashboard` and I have been given read access. Read `docs/SETUP-WITH-CLAUDE.md` in that repo and follow the "Instructions for Claude" section exactly, one step at a time. Stop and ask me whenever a step needs me to log in, confirm a payment, or approve something. Never print, log or commit a secret key, and never paste one into a chat message.

---

## Instructions for Claude

You are helping the Owner set up a private copy of this app on their own accounts. Work in this order. After each step, check that it worked before you start the next one, and tell the user in one line what you did. If a command fails, read the error, fix the cause, and try again once before you ask the user.

**Rules for the whole job**

- Every account belongs to the user. Do not create accounts, enter card details, or solve verification codes. Ask the user to do those.
- Secrets (the Supabase `service_role` key, the Supabase access token, `CRON_SECRET`, passwords) go only into environment variables or the hosting provider's secret storage. Never print them back, never write them into a file that is committed, never put them in a commit message.
- Do not change the app's code except where a step below says so.

### 1. Make the user's own copy of the code

1. Run `gh auth status`. If the user is not logged in, ask them to run `gh auth login` and choose GitHub.com and a web browser login.
2. Clone the source repo into a folder named `content-ops`:
   `gh repo clone Samuel-boston/content-ops-dashboard content-ops`
3. In that folder, remove the old history and the developer-only tools, and start fresh history:
   ```
   cd content-ops
   rm -rf .git scripts
   ```
   Then open `package.json` and delete the two scripts `db:push` and `build:docs` (they point at the folder you just removed).
4. Confirm no secrets are in the copy: `git init -b main && git add -A && git ls-files | grep -i env`. The only line allowed is `src/lib/env.ts`. Commit with `git commit -m "Initial copy"`.
5. Create the user's own private repo and push:
   `gh repo create content-ops --private --source . --push`
6. Open `vercel.json`. The `regions` value must be the Vercel region closest to the user's Supabase region (London `lhr1`, Frankfurt `fra1`, US East `iad1`, US West `sfo1`). Ask the user which Supabase region they chose. Change it if needed, commit and push.

### 2. Set up the database

1. Ask the user for the **Project URL** and the project reference (the part before `.supabase.co`). Ask them to create a **personal access token** at supabase.com/dashboard/account/tokens named "setup" and to put it in an environment variable called `SUPABASE_ACCESS_TOKEN` in their terminal (not in chat). They will delete this token at the end.
2. Fetch the project's keys with the Management API: `GET https://api.supabase.com/v1/projects/{ref}/api-keys`. Keep the `anon` and `service_role` values in shell variables. Do not print them.
3. Run the whole of `supabase/setup_all.sql` once against the project: `POST https://api.supabase.com/v1/projects/{ref}/database/query` with body `{"query": "<file contents>"}`. Send it as JSON built with a tool such as `jq` so the quotes are escaped. A successful response contains no error. This file is safe to run once on an empty project. Do not run it twice.
4. Set the login rules with `PATCH https://api.supabase.com/v1/projects/{ref}/config/auth` and body `{"disable_signup": true, "mailer_autoconfirm": true, "password_min_length": 12}`. Then read the config back with `GET` and confirm the three values. If the API rejects a field name, check the current Supabase Management API reference and use the right name. If it still cannot be done, ask the user to set these in the dashboard: Authentication → Sign In / Providers → Allow new users to sign up **OFF**, Confirm email **OFF**, then press **Save changes**; Authentication → Password minimum length **12**.
5. Prove sign-ups are closed. Call `POST {project-url}/auth/v1/signup` with the anon key and a made-up email and password. It must fail with a "signups not allowed" error. If it succeeds, sign-ups are open: delete that made-up user and fix step 4 before you go on.
6. Raise the file upload limit to 500 MB with `PATCH https://api.supabase.com/v1/projects/{ref}/config/storage` and `{"fileSizeLimit": 524288000}`, or ask the user to do it under Storage → Settings. Remember the number in MB for step 3.

### 3. Deploy to Vercel

1. Install the CLI if needed (`npm i -g vercel`) and ask the user to run `vercel login`.
2. In the folder: `vercel link` and create a new project named `content-ops`. Then connect the repo so every push deploys: `vercel git connect`.
3. Generate `CRON_SECRET` as 40 random characters (for example `openssl rand -hex 20`). Ask the user to save it in their password manager: they need it later for the scheduled jobs.
4. Add these to the **Production** environment with `vercel env add NAME production`, passing the value on standard input so it never appears on screen:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
   | `CRON_SECRET` | the value from step 3 |
   | `NEXT_PUBLIC_MAX_UPLOAD_MB` | the same number as the Supabase limit, in MB (500) |

5. Deploy: `vercel deploy --prod`. Note the production address (for example `https://content-ops-xyz.vercel.app`).
6. Add `NEXT_PUBLIC_APP_URL` (the address, with no trailing slash) as another Production variable, then redeploy with `vercel deploy --prod`.
7. Open the address and confirm the login page loads.

### 4. Create the Owner login

Sign-ups are closed on purpose, so the Owner is created directly.

1. Ask the user for their email, full name, and a password of at least 12 characters (they will change it on first sign-in). Do not echo the password.
2. Create the user with the Auth admin API using the service_role key: `POST {project-url}/auth/v1/admin/users` with `{"email": "...", "password": "...", "email_confirm": true}`.
3. Run this SQL through the database query endpoint (fill in the email and name):
   ```sql
   update auth.users
   set raw_app_meta_data = raw_app_meta_data || '{"role":"owner","invited":true}'::jsonb,
       raw_user_meta_data = raw_user_meta_data || '{"full_name":"THE NAME"}'::jsonb
   where email = 'THE EMAIL';
   ```
4. Ask the user to sign in at the site, then open the avatar menu → **Change password** and set their own.
5. Check that a `profiles` row exists for that user with role `owner`. If it does not, tell the user and stop.

### 5. First settings

Ask the user to open avatar menu → **Settings** and set the workspace name, their first name, and a logo, then press Save. They can also press **Set up your integrations** to see the guides.

### 6. Clean up

1. Tell the user to delete the Supabase personal access token they created (supabase.com/dashboard/account/tokens) and unset `SUPABASE_ACCESS_TOKEN`.
2. Remind them to turn on 2-step login for GitHub, Vercel, Supabase and Google.
3. Tell them Nathan can now remove their read access to the source repo.

### 7. Then the integrations

Ask the user which integrations they want next. Each has a guide in `docs/04-integration-guides.md` and inside the app (Settings → Set up your integrations). Recommended order: Cloudflare Stream, Google Drive, Groq, scheduled jobs (cron-job.org), Telegram, Instagram, email, then each person's own Claude.

- **Cloudflare Stream, Google Drive, Groq, Telegram:** the user pastes the values into Settings. Guide them through the account steps; use Claude in Chrome for the clicking if they have it installed.
- **Scheduled jobs:** two cron-job.org jobs that call `{address}/api/cron/publish?key={CRON_SECRET}` every 5 minutes and `{address}/api/cron?key={CRON_SECRET}` once a day. If the user gives you a cron-job.org API key you can create them; otherwise walk them through the site.
- **Email (Resend):** `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are Vercel Production variables, set with `vercel env add`, then redeploy.
- **Instagram / Meta:** Meta may ask the user to verify their business first. That wait is outside anyone's control. Tell them to post by hand until it clears; nothing breaks meanwhile.

Never type a password, card number or verification code on the user's behalf. Stop and ask.
