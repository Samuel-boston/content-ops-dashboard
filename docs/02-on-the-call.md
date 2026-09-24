# 2 · On the call — Nathan runs it, Adam clicks

**About 90 minutes.** Adam drives (screen share), so he learns where everything is. Only do what's below — everything else is in `03-after-the-call.md` and can happen afterwards without you.

**Rule for the whole call:** every account is created on **Adam's** email with **Adam's** card. Turn on 2-step login for GitHub, Vercel, Supabase and Google as you go.

---

## 1. Accounts (10 min)

Adam creates, in this order: **GitHub** (he probably has it) → **Vercel** (sign in with GitHub, then upgrade to **Pro**) → **Supabase** (upgrade the project to **Pro** in step 2).

☐ GitHub repo exists and holds the code · ☐ Vercel Pro active

---

## 2. Supabase project (10 min)

1. New project. Name it, pick a **region near the team** (must match `vercel.json`), set and **save the database password**.
2. **Project Settings → Billing:** upgrade to **Pro** (this switches on daily backups).
3. **Project Settings → API:** copy three things to a private note — *Project URL*, *anon public key*, *service_role key*. The service_role key is a master key: **never** put it in chat, email or a screenshot.

---

## 3. Database + login settings (10 min)

1. **SQL Editor → New query.** Paste the whole of `supabase/setup_all.sql` from the repo. **Run.** Ends with "Success". (Confirm the "destructive operation" warning — it's an empty database.)
2. **Authentication → Sign In / Providers:** turn **Allow new users to sign up OFF**. Turn **Confirm email OFF**. Press **Save changes** — *the toggle does nothing until you press Save.*
3. **Authentication → Attack Protection / Password:** minimum password length **12**.
4. **Storage → Settings:** raise the global file size limit (e.g. **500 MB**) so big cuts can upload. Remember the number for §4.

☐ Success message · ☐ Sign-ups OFF **and saved** · ☐ Backups listed under Database → Backups

---

## 4. Vercel deploy (15 min)

1. **Add New → Project →** import Adam's GitHub repo. Framework Next.js (automatic).
2. **Environment Variables** (Production). Names must match exactly:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
| `NEXT_PUBLIC_APP_URL` | the site address, e.g. `https://adam-content.vercel.app` — no trailing slash (add after the first deploy shows the address, then redeploy) |
| `CRON_SECRET` | 30+ random characters — save it, `03` needs it |
| `NEXT_PUBLIC_MAX_UPLOAD_MB` | the same number as the Supabase limit (e.g. `500`) |

3. **Deploy.** Open the address: the login page should appear.

☐ Login page loads

---

## 5. Adam's Owner login (5 min)

Sign-ups are closed on purpose, so the Owner is created in Supabase:

1. **Authentication → Users → Add user → Create new user.** His email + a password. Tick **Auto Confirm User**.
2. **SQL Editor** → run (change the email and name):
   ```sql
   update auth.users
   set raw_app_meta_data = raw_app_meta_data || '{"role":"owner","invited":true}'::jsonb,
       raw_user_meta_data = raw_user_meta_data || '{"full_name":"Adam Kunder"}'::jsonb
   where email = 'adam@his-email.com';
   ```
3. He signs in at the site → **avatar menu → Change password** and sets his own.

☐ He can sign in and sees the dashboard

---

## 6. Settings basics (5 min)

Avatar menu → **Settings** (Owner only). Set the workspace name, **his first name** (used through the dashboard), upload a logo. Save.

Show him **Set up your integrations** at the top — three tabs (Claude Chrome extension / ChatGPT computer control / Manually). Explain: "you can follow the steps yourself, or give the prompt to Claude or ChatGPT and it does the clicking".

---

## 7. Video playback — Cloudflare Stream (10 min, do this live)

It's quick and it lets you demo the review room. Follow the **Cloudflare Stream** guide (`04-integration-guides.md`, or the guide in Settings). Then upload any short video on a test video and press play.

☐ A cut uploads and plays

---

## 8. Add the team (10 min)

**Team page → Seats.** Add one of each so he sees how it works: name, email, temporary password (8+ characters), role — **Editor**, **Copywriter**, **VA**, (**Admin**, Owner only). Show:
- the person signs in and changes the password (**avatar menu → Change password**),
- **Reset password** and **Deactivate** next to each name,
- nobody can sign themselves up.

(Delete these demo seats afterwards unless they're real.)

---

## 9. Live walkthrough (20 min) — use `05-how-it-works.md`

1. Create an idea → drag it through Scripting → Script Review → Ready to Film → Editor Brief → Ready to Edit.
2. Editor login: take it, upload a cut, submit for review.
3. Owner: review → approve → **Ready to Post → drag to With the VA** → check each variant's destination and caption → Send.
4. VA login: open it, work through the variants, **Mark as posted**.
5. Show the **Archive** (calendar view) and the **Calendar**.
6. Delete the test video.

☐ Full loop worked

---

## 10. Hand over the list (5 min)

Open `03-after-the-call.md` together and go through it line by line. Point out the three slow things that are **not his fault**: Meta verification, DNS for email, Google consent screen. Agree who he messages if stuck (you), and when you'll check in (suggest 48 hours).

---

## Skip on the call (all in file 3)

Google Drive · Instagram/Meta · Telegram · email · the 5-minute scheduled job · Groq · each person connecting their own Claude. Do **not** try to do these live — several involve waiting on Google/Meta/DNS.
