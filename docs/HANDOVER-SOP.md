# Handover SOP — moving the Content Ops dashboard to a client

Goal: the client ends up with **his own copy** of the code, database, hosting and accounts. Nothing stays on Nathan's accounts. Nathan keeps the master copy for other clients.

**Time:** about 2 hours on a call, plus a dry run beforehand. **Nathan = N. Client = C.**

---

## 0. What is what

| Piece | What it does | Whose account |
|---|---|---|
| GitHub repo | The code | C |
| Vercel | Hosts the website | C (Pro plan, ~$20/mo) |
| Supabase | Database, logins, small files | C (Pro plan, ~$25/mo — includes daily backups) |
| Cloudflare Stream | Video playback + review | C (~$5/mo to start) |
| Google Drive | Raw footage + posted archive | C |
| Meta / Instagram | Posting + analytics | C |
| Groq | Free AI (voice notes, idea sorting) | C (free) |
| Telegram | Idea capture from phone | C (free) |
| Resend | Notification emails | C (free) |
| cron-job.org | Runs scheduled posts every 5 minutes | C (free) |

---

## 1. Before the call — Nathan

1. **Dry run.** Create a throwaway Supabase project, run `supabase/setup_all.sql` (step 5), deploy the copy to a throwaway Vercel project, and log in. Delete both afterwards. Do this once per new client — it is the only way to know the copy works.
2. **Make the client's copy** (your master stays untouched):
   ```
   git clone https://github.com/Samuel-boston/content-ops-dashboard.git client-copy
   cd client-copy
   rm -rf .git scripts          # scripts/ are dev seed tools, not needed
   git init -b main && git add -A && git commit -m "Initial copy"
   ```
   The client creates an empty **private** GitHub repo and adds Nathan as a collaborator. Then:
   ```
   git remote add origin https://github.com/CLIENT/content-ops.git
   git push -u origin main
   ```
3. Check `vercel.json` → `"regions"`: set it to the Vercel region **closest to the client's Supabase region** (Supabase London → `lhr1`, Frankfurt → `fra1`, US East → `iad1`). Wrong region = every click feels slow.
4. Tell the client to have ready: a card, his Google account, his Instagram login, a domain name for email (optional).

---

## 2. Accounts — Client

Create each, on his own email, with his own card. Turn on 2-step login for GitHub, Vercel, Supabase and Google.

- github.com → vercel.com (sign in with GitHub, **upgrade to Pro**) → supabase.com (**Pro**) → cloudflare.com → console.groq.com → resend.com → cron-job.org → Telegram → Meta Business.

---

## 3. Supabase — Client (Nathan guides)

1. New project. Name it, choose a region near the team, save the database password somewhere safe. Plan: Pro.
2. **Project Settings → API:** copy three values — *Project URL*, *anon public key*, *service_role key*. The service_role key is a master key: never post it in chat, email or a screenshot.
3. **Authentication → Sign In / Providers:** turn **Allow new users to sign up OFF** and press **Save changes**. Turn Confirm email OFF (people are added by the Owner, not by email invite).
4. **Authentication → Attack Protection / Password strength:** set minimum password length to 12.
5. **SQL Editor → New query:** open `supabase/setup_all.sql` from the repo, paste all of it, press **Run**. It ends with "Success". (If a "destructive operation" warning appears, confirm — it's a new empty database.)
6. **Storage → Settings:** raise the *global file size limit* to match the plan (e.g. 500 MB). Later set `NEXT_PUBLIC_MAX_UPLOAD_MB` in Vercel to the same number, or uploads over 50 MB will be refused.
7. **Database → Backups:** confirm daily backups are listed (Pro). This is the backup plan — there is nothing else to set up.

---

## 4. Vercel — Client (Nathan guides)

1. **Add New → Project → import the GitHub repo.** Framework: Next.js (auto).
2. **Environment Variables** (Production). Names must match exactly:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL from step 3.2 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
   | `NEXT_PUBLIC_APP_URL` | the site address, e.g. `https://content-ops.vercel.app` (no trailing slash) |
   | `CRON_SECRET` | a long random string (30+ characters) — save it, step 8 needs it |
   | `NEXT_PUBLIC_MAX_UPLOAD_MB` | (optional) same as the Supabase file limit |
   | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | (optional) set in step 7 |

3. **Deploy.** When it's live, open the address — you should see the login page.
4. Optional: **Settings → Domains** to use his own domain, then update `NEXT_PUBLIC_APP_URL` and redeploy.

---

## 5. First login (the Owner) — Nathan

Sign-ups are closed, so the Owner's login is created in Supabase:

1. **Authentication → Users → Add user → Create new user.** Enter his email and a password, tick *Auto Confirm User*.
2. **SQL Editor** → run this (change the email and name):
   ```sql
   update auth.users
   set raw_app_meta_data = raw_app_meta_data || '{"role":"owner","invited":true}'::jsonb,
       raw_user_meta_data = raw_user_meta_data || '{"full_name":"Client Name"}'::jsonb
   where email = 'client@email.com';
   ```
3. He signs in at the site. If he sees the dashboard, it worked. He then goes to **avatar menu → Change password** and sets his own.

---

## 6. Settings — Client

Avatar menu → **Settings** (Owner only).

1. Workspace name, his first name (used across the dashboard), logo.
2. **Set up your integrations** — a guide for each one. Pick a tab:
   - **Manually** (default): follow the steps.
   - **Claude Chrome extension** or **ChatGPT computer control**: install/enable it as shown, press *Copy the prompt*, paste it — the AI does the clicking and stops at logins, codes and payments.

   Do them in this order: **Cloudflare Stream → Google Drive → Groq → Instagram → Telegram**. Save settings after each. Test as you go:
   - Stream: upload a cut on any video and play it.
   - Drive: press **Test the connection** — must say Connected.
   - Instagram: a video in Ready to Post → Post tab shows the Instagram channel.
   - Telegram: send the bot a text — an idea appears in Ideation.

---

## 7. Email + scheduled jobs — Client

Follow the **Email (Resend)** and **Scheduled jobs (cron-job.org)** guides in Settings. Email needs a Vercel redeploy after the two variables are added. The 5-minute job is what makes scheduled Instagram posts go out on time — without it they only run once a day.

---

## 8. Add the team — Client (Owner)

**Team page → Seats.**

1. Enter **name, email, a temporary password (8+ characters)** and pick the role: **Editor**, **Copywriter**, **VA (posting)** or **Admin** (Owner only).
2. Send them the site address, their email and the temporary password (not in a group chat).
3. They sign in and change it: **avatar menu → Change password**.
4. Forgotten password: Team page → **Reset password** next to their name → give them the new temporary one.
5. Someone leaves: **Deactivate** (their work stays).

Nobody can sign themselves up — every seat is created by the Owner or an Admin. Each person can also connect their own Claude: **avatar menu → Connect AI** (see the Claude guide in Settings).

---

## 9. Go-live test — do this together, then delete the test video

1. Owner: create an idea → move it through Scripting → Script Review → Ready to Film → Editor Brief → Ready to Edit.
2. Editor login: take it on, upload a cut, submit for review.
3. Owner: watch it, approve. Ready to Post → drag to **With the VA** → check each variant's destination and caption → Send.
4. VA login: open it, download the file, tick variants posted, **Mark as posted**.
5. Check the **Archive** shows it, and a folder appeared in Google Drive under the right month.
6. Copywriter login: sees only planning stages; Claude connection lists ideas.
7. Delete the test video. Done.

---

## 10. Keeping it running

- **Backups:** Supabase Pro daily backups (7 days). Restore: Supabase → Database → Backups. Uploaded files in Supabase Storage (music, references, covers, carousel images) are not in those backups; finished videos and footage are in Google Drive.
- **Nothing expires** if the guides were followed (Instagram uses a never-expiring system-user token; Google login was published to production).
- **If something looks stuck:** Vercel → project → Logs. Common causes: a missing environment variable, or a key that was pasted with a missing character (the Drive Test button says which).
- **Updates:** Nathan pulls improvements from the master repo and pushes to the client's repo; Vercel redeploys automatically. Database changes ship as new `supabase/migration_*.sql` files — run them in the SQL Editor.
- **Costs:** ~$45–55/mo fixed (Vercel Pro + Supabase Pro + Cloudflare Stream base) plus Stream usage. Everything else is free at this scale.
- **Never share:** the `service_role` key, Vercel environment variables, or Settings screenshots.
