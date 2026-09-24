# Content Ops — full handover pack

Read in this order. **Files 1–2 are for Nathan** (before and during the call). **Files 3–6 are Adam's resource** — he does file 3 after the call, at his own pace, and keeps 4–6 for reference.

| # | File | Who | When |
|---|---|---|---|
| 1 | `01-before-the-call.md` | Nathan | Before the call (make his copy) |
| 2 | `02-on-the-call.md` | Nathan + Adam | The call itself (about 90 minutes) |
| 3 | `03-after-the-call.md` | Adam | After the call — the checklist, with what's slow and not his fault |
| 4 | `04-integration-guides.md` | Adam | Step-by-step for each integration (also inside the dashboard: Settings → Set up your integrations) |
| 5 | `05-how-it-works.md` | Adam + team | How the whole thing is used day to day |
| 6 | `06-running-it.md` | Adam | Costs, backups, updates, what to do when something breaks |

`HANDOVER-PACK.md` is all of them in one file. `CLIENT-RESOURCE.md` is files 3–6 in one file (what Adam gets).

---

---

# 1 · Before the call — Nathan

Goal: on the call nothing should be a surprise. Do this the day before.


## A. Make Adam's copy (your master stays untouched)

```
git clone https://github.com/Samuel-boston/content-ops-dashboard.git client-copy
cd client-copy
rm -rf .git scripts          # scripts/ are your dev seed tools; he doesn't need them
git init -b main && git add -A && git commit -m "Initial copy"
```

Adam creates an **empty private GitHub repo** and adds you as a collaborator. Then:

```
git remote add origin https://github.com/ADAM/content-ops.git
git push -u origin main
```

Check before pushing: `git ls-files | grep -i env` must print nothing (no keys in the repo).

## B. Set the hosting region

Open `vercel.json` in the copy. Set `"regions"` to the Vercel region closest to **his Supabase region**:

| His Supabase region | Vercel region |
|---|---|
| London / eu-west-2 | `lhr1` |
| Frankfurt / eu-central-1 | `fra1` |
| US East (N. Virginia) | `iad1` |
| US West | `sfo1` |

Wrong region = every click takes seconds instead of milliseconds (this was the "it's so slow" problem). Commit and push.

## C. Tell Adam what to have ready

- A card (three subscriptions: Vercel Pro, Supabase Pro, Cloudflare Stream).
- His Google account, Instagram login, and his email inbox (verification codes).
- Chrome installed (needed for the Claude / ChatGPT auto-setup option).
- ~90 minutes, no interruptions.

## D. Checklist

- [ ] Copy pushed to Adam's GitHub, you have access
- [ ] `vercel.json` region set
- [ ] Adam has told you which email he'll use for everything

---

---

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

---

---

# 3 · After the call — your checklist (Adam)

The dashboard is live and you can already run the whole pipeline. What's left are the **connections** to other services. Do them in your own time, in this order. Each one has a step-by-step guide in `04-integration-guides.md` — and the same guide is inside the dashboard: **avatar menu → Settings → Set up your integrations**, where you can either follow the steps **or** copy a prompt and let Claude (Chrome extension) or ChatGPT (computer control) do the clicking for you.

**Tip:** do one at a time and press **Save settings** + test after each.

## Checklist

| # | Connect | Why you want it | Effort | Waiting involved? |
|---|---|---|---|---|
| 1 | **Google Drive** | Archive of finished videos, raw footage, scripts and covers, filed by month | 30 min | No |
| 2 | **Groq** (free AI) | Voice notes → transcripts, sorts ideas from Telegram | 5 min | No |
| 3 | **Scheduled jobs** (cron-job.org) | Scheduled posts go out on time; finished uploads get picked up | 10 min | No |
| 4 | **Telegram** | Send an idea from your phone in 10 seconds | 15 min | No |
| 5 | **Publer** (or Instagram / Meta) | Post and schedule Reels from the dashboard, **including trial reels** | Publer 15 min · Meta 1–2 hrs | Publer: no. Meta: **maybe — see below** |
| 6 | **Email** (Resend) | "You were mentioned / revisions requested" emails | 20 min | **Yes — DNS** |
| 7 | **Your own Claude** | Work on scripts and run the board from inside Claude | 10 min each person | No |
| 8 | **Upload limit** (only if you skipped it on the call) | Cuts bigger than 50 MB | 5 min | No |

You can run the business without 5, 6 and 7 — the VA can always post by hand from the Instagram app and tick Posted. Do 1–4 first. Publer (a paid Business plan) is the quickest way to post from the dashboard: no Meta app, no Meta verification, and it can post trial reels.

## What's slow and **not your fault**

These are outside anyone's control. If one stalls, note where and message Nathan — don't lose a day to it.

- **Meta (Instagram), only if you connect Instagram directly instead of Publer.** Meta sometimes asks you to verify your business or identity before it lets an app connect to Instagram. That can take from minutes to a few days. Until it's done, post by hand and tick **Posted** in the dashboard — nothing breaks.
- **Email DNS.** After adding the records Resend gives you at your domain provider, verification can take anywhere from a few minutes to a few hours (rarely a day). Notifications still show inside the dashboard in the meantime.
- **Google's consent screen.** Google shows an "unverified app" warning for your own app. That's normal — click *Advanced → Continue*. It is what lets the login stay permanent.

## Things only you can do (the dashboard can't do them for you)

- Keep your **passwords, the Supabase `service_role` key and the Vercel environment variables private** — never in chat, email or screenshots.
- Give each team member their login (Team page → Seats) and ask them to change the password on first sign-in.
- If you change domain or address, update `NEXT_PUBLIC_APP_URL` in Vercel and redeploy.

## When you're done

Send Nathan a one-line message: which numbers above are done and which are waiting. He'll check the connections with you.

---

---

# 4 · Integration guides

Each guide can be done **three ways**. In the dashboard open **avatar menu → Settings → Set up your integrations** and pick a tab:

- **Manually** — follow the steps below.
- **Claude Chrome extension** — install and connect the Claude extension in Chrome, press **Copy the prompt** on the guide, paste it into Claude. It does the clicking and stops at logins, verification codes and payments.
- **ChatGPT computer control** — the same prompt, for ChatGPT's agent/computer control on your Mac.

The prompts contain no passwords or keys. The AI types values only into the boxes in Settings. Save settings after each one and test it.

Recommended order: **Google Drive → Groq → scheduled jobs → Telegram → Publer (or Instagram) → email → your own Claude.** (Cloudflare Stream was done on the call.)

---

## Cloudflare Stream — video playback and review

Plays and reviews finished cuts. Pay-as-you-go: roughly $5 per 1,000 minutes stored and $1 per 1,000 delivered (check Cloudflare's current pricing).

### Steps

1. Go to dash.cloudflare.com and sign up or log in.
2. In the left menu open Stream (under Media) and subscribe to Stream. Leave Cloudflare Images unchecked — it isn't used.
3. Copy the Account ID (shown on the Stream page and in the dashboard URL).
4. Open My Profile → API Tokens → Create Token → Create Custom Token. Give it the permission Account · Stream · Edit, for your account only. Create it and copy the token now — it is only shown once.
5. Upload any short test video in Stream and open it. Its playback links look like customer-abc123.cloudflarestream.com — copy the part after “customer-” (abc123).

### Paste into Settings

- Cloudflare Stream → Account ID
- Cloudflare Stream → API token
- Cloudflare Stream → Customer subdomain code

### Then

Save settings, then upload a cut on any video in the dashboard and check it plays.

---

## Google Drive — the permanent archive

Stores raw footage, finished videos and the posted archive. Free with a Google account. These steps make the login permanent (it does not expire after 7 days).

### Steps

1. In Google Drive create a folder for the archive (for example “Content Ops”). Open it and copy the folder ID — the long code at the end of the address (…/folders/THIS-PART).
2. Go to console.cloud.google.com and create a new project (any name).
3. APIs & Services → Library → search “Google Drive API” → Enable.
4. APIs & Services → OAuth consent screen (Google Auth Platform) → set it up as External, add your own email, then press “Publish app” so its status is In production. This is what stops the login expiring after 7 days. Ignore any “unverified app” warning — it's your own app.
5. APIs & Services → Credentials → Create Credentials → OAuth client ID → type Web application. Under Authorised redirect URIs add exactly: https://developers.google.com/oauthplayground . Create it and copy the Client ID and Client secret.
6. Open developers.google.com/oauthplayground. Click the gear icon (top right), tick “Use your own OAuth credentials”, and paste the Client ID and Client secret.
7. In Step 1 type the scope https://www.googleapis.com/auth/drive into the box, press Authorise APIs, and sign in with the Google account that owns the folder (Continue through the unverified-app screen).
8. In Step 2 press “Exchange authorization code for tokens” and copy the Refresh token (starts with 1//).
9. Build the login JSON (see “Google login JSON” below) and paste it into Settings.

### Paste into Settings

- Google Drive → Target folder ID  (the folder ID from step 1)
- Google Drive → Google login JSON  (paste exactly: {"type":"authorized_user","client_id":"…","client_secret":"…","refresh_token":"…"} with your three values)

### Then

Save settings, then press “Test the connection” — it must say Connected. Careful copying the refresh token: letters O and zero look alike.

---

## Publer — post to Instagram (including trial reels), YouTube, TikTok and LinkedIn

The easy way to post from the dashboard: no Meta app or verification needed, and it can post Instagram trial reels, which Meta's own API cannot. Needs a Publer Business plan (check Publer's current pricing); it replaces the Meta / Instagram guide for posting.

### Steps

1. Go to publer.com and sign up or log in. Choose a Business plan — the API is not available on lower plans.
2. In Publer open Social Accounts → Add account, and connect each account you post from: Instagram (a Professional Creator or Business account), YouTube, TikTok and/or LinkedIn.
3. Open Settings → Access & Login → API Keys → Create API Key. Give it a name and tick these permissions: workspaces, accounts, posts and media. Create it and copy the key now.
4. In this dashboard open Settings → Publer, paste the key, and press Connect. It finds your workspace and accounts by itself; if you have more than one of a kind it asks which to post to.

### Paste into Settings

- Publer → the API key box, then the Connect button (nothing else to fill in)

### Then

The Publer card turns green and lists each connected account. Press “Test the connection” to check it. Then on any video that is with the VA, mark a variant as a trial reel and press “Post trial reel via Publer…”. Choose whether trial reels stay trials or may be shared by Instagram automatically at the top of the Publer card.

---

## Meta / Instagram — analytics and posting

Lets the dashboard post and schedule Reels and carousels to the feed and read their numbers. Free. Meta's own API cannot post trial reels — use the Publer guide above if you want those posted from the dashboard.

### Steps

1. Make sure the Instagram account is a Professional account (Creator or Business) and is linked to a Facebook Page you manage.
2. Go to business.facebook.com and create (or open) the Business portfolio that owns that Page and Instagram account.
3. Go to developers.facebook.com → My Apps → Create App → type Business. Add the product “Instagram” (Instagram API with Facebook Login) and connect the app to the same Business portfolio.
4. In business.facebook.com → Settings → Users → System users, add a system user (role Admin). Assign it the app (full control) and the Page and Instagram account (full control).
5. Generate a token for that system user: pick your app, set expiry to Never, and tick these permissions: instagram_basic, instagram_content_publish, instagram_manage_insights, pages_show_list, pages_read_engagement, business_management. Copy the token — it is shown once, and unlike a normal token it does not expire every 60 days.
6. Find the Instagram user ID: in Graph API Explorer with that token call  me/accounts?fields=instagram_business_account  and copy the instagram_business_account id (a long number).
7. The app can stay in Development mode — it only ever posts to your own account, so Meta app review is not needed.

### Paste into Settings

- Instagram Graph API → IG Business/Creator user ID
- Instagram Graph API → Long-lived access token

### Then

Save settings. Then, on any video that is with the VA, open the Post tab: the Instagram channel should now appear. Post a test to the feed to confirm.

---

## Groq — free AI for transcription and idea sorting

Powers voice-note transcription and sorting ideas that arrive from Telegram. The free tier has daily limits that comfortably cover one small team; no card is needed.

### Steps

1. Go to console.groq.com and sign up or log in.
2. Open API Keys → Create API Key, name it “Content Ops”, and copy it (shown once).

### Paste into Settings

- AI scripting → Engine: choose Groq
- AI scripting → Groq API key

### Then

Save settings. Send a short voice note to the Telegram bot (if set up) and check the idea arrives with a transcript.

---

## Telegram — capture ideas from your phone

Anything sent to a private Telegram chat lands in Ideation. Free.

### Steps

1. In Telegram open a chat with @BotFather, send /newbot, choose a name and a username, and copy the bot token it gives you.
2. Create a private group (or use a private chat with the bot) and add the bot to it. Send any message in it.
3. Find the chat ID: in a browser open https://api.telegram.org/bot<YOUR-TOKEN>/getUpdates (replace <YOUR-TOKEN>), and look for  "chat":{"id": …}  — a number, negative for groups. Copy it.
4. Register the webhook by opening this address in a browser (replace <YOUR-TOKEN>):  https://api.telegram.org/bot<YOUR-TOKEN>/setWebhook?url=https://YOUR-SITE.vercel.app/api/telegram/webhook  — it should answer {"ok":true}.

### Paste into Settings

- Telegram automations → Bot token
- Telegram automations → Authorised chat IDs

### Then

Save settings, then send a text message to the chat — a new idea should appear in Ideation within seconds.

---

## Slack — ask the dashboard from Slack, and hear what moves

Lets the team say "add this to ideas" or "how many videos are in scripting?" in Slack, and posts to a channel when scripts are done, cuts are ready for review, videos are approved or posted. Free on any Slack plan.

### Steps

1. Create your Slack workspace if you haven't (slack.com), and make sure everyone who should use it is in it.
2. In this dashboard open Settings → Slack and press “Copy the app manifest”. It already contains this dashboard's address, the /ops command and every permission.
3. Go to api.slack.com/apps → Create New App → From a manifest. Pick your workspace, paste the manifest, and press Create.
4. On the app's page press Install to Workspace and allow it.
5. Copy the Signing Secret (Basic Information page) and the Bot User OAuth Token (OAuth & Permissions page, starts with xoxb-).
6. Back in Settings → Slack paste both and press Connect, then pick the channel updates should go to.
7. Make sure each person has a seat in the dashboard (Team → Seats) using the same email as on their Slack profile — that's how the bot knows who is asking and what they may see.

### Paste into Settings

- Slack → Bot User OAuth Token
- Slack → Signing Secret
- Slack → the channel to announce in

### Then

Press “Send a test message”, then in Slack try /ops how many in scripting and /ops add idea: a test idea. You can also @-mention the bot in a channel or message it directly.

---

## Email notifications (Resend)

Sends the “you've been mentioned / revisions requested” emails. Free tier is plenty. These two values are set in Vercel, not in this page.

### Steps

1. Go to resend.com, sign up, and add your sending domain (Domains → Add Domain). Add the DNS records it shows at your domain provider and press Verify.
2. API Keys → Create API Key (Sending access) and copy it.
3. In Vercel open the project → Settings → Environment Variables and add RESEND_API_KEY (the key) and RESEND_FROM_EMAIL (for example  Content Ops <notifications@yourdomain.com>). Apply to Production.
4. Redeploy the project (Deployments → the latest → Redeploy) so the new values load.

### Paste into Settings

- Vercel environment variable RESEND_API_KEY
- Vercel environment variable RESEND_FROM_EMAIL

### Then

Mention a teammate in a video comment and check the email arrives.

---

## Scheduled jobs (cron-job.org) — so scheduled posts go out on time

Vercel's own free schedule only runs once a day. This free service calls the dashboard every 5 minutes so scheduled Instagram posts and finished uploads are picked up promptly.

### Steps

1. In Vercel → Settings → Environment Variables make sure CRON_SECRET is set to a long random string (30+ characters). Copy it.
2. Go to cron-job.org, sign up, and choose Create cronjob.
3. Job 1 — URL:  https://YOUR-SITE.vercel.app/api/cron/publish?key=YOUR-CRON-SECRET  — schedule: every 5 minutes.
4. Job 2 — URL:  https://YOUR-SITE.vercel.app/api/cron?key=YOUR-CRON-SECRET  — schedule: once a day.

### Paste into Settings

- Two cron-job.org jobs (nothing to paste into Settings)

### Then

Use the “Test run” button on each job — the response should be JSON containing  "ok":true.

---

## Connect your own Claude (each team member, optional)

Lets someone work on scripts or run the board from inside Claude. Uses their existing Claude plan — no extra cost.

### Steps

1. Sign in to the dashboard as that person, open the account menu (top right) and choose Connect AI.
2. Press Generate token, name it, and copy the token (shown once).
3. In Claude (claude.ai or the desktop app) open Settings → Connectors → Add custom connector. Paste the Server URL shown on the Connect AI page and the token as instructed there.
4. In a chat, ask “what videos are in ideation?” to confirm it can see the board.

### Paste into Settings

- Done per person, on the Connect AI page

### Then

Copywriters can list ideas, write scripts and move them between Ideation and Scripting; owners and admins can do more.

---

---

# 5 · How it works day to day

## The idea in one line

Every video is a card that moves left to right through stages. Each person only sees the stages that are theirs, and every move tells the next person it's their turn.

## The stages

**Videos:** Ideation → Scripting → Script Review → Ready to Film → Editor Brief → Ready to Edit → Editing → In Review → Revisions (if changes) → *Awaiting Variants* (only if the script has several hooks) → Final Review → **Ready to Post → With the VA → Posted** (goes to the Archive).

**Carousels:** Ideation → Scripting → Script Review → Needs Creatives → Creatives to Review → Ready to Post → With the VA → Posted.

**Later:** any video, at any stage, can be shelved with the **Later** button (top of the video) and picked back up from **More → Later**. It leaves every board and count until you bring it back.

## Who does what

| Role | Sees | Does |
|---|---|---|
| **Owner** (you) | Everything, plus Settings | Approves scripts and cuts, sends videos to the VA, manages the team |
| **Admin** | Everything except Settings | Same as Owner day to day (only the Owner can add Admins) |
| **Copywriter** | Ideation → Script Review only | Writes scripts and hooks, submits them for review; can use Claude to draft |
| **Editor** | Only videos assigned to them, plus the pool to take on | Takes on a video, uploads the cut, submits for review, delivers hook variants, tracks their month and time off |
| **VA** | Posting board, Archive, Other tasks, Library, Time off | Posts videos, marks them posted, works through "Other" tasks |

## The everyday flow

1. **Idea.** Add it on the board (or send it to the Telegram bot from your phone — it lands in Ideation). Write the script, or let the copywriter do it.
2. **Script review.** The copywriter submits; you read it, leave comments on any part, and either approve it (→ Ready to Film) or send it back (→ Script Revisions). Carousels approve into Needs Creatives.
3. **Film → brief.** Upload the raw footage (drag it onto the video), then build the **Editor Brief** — written notes, attachments, music tagged from the library — and send it to editors.
4. **Editing.** An editor takes it on (giving an ETA), uploads the cut, submits it. The upload box shows two steps: your file uploading (keep the page open) and Cloudflare preparing the video (you can close the page).
5. **Review.** You watch the cut, drop comments pinned to the exact moment (text, voice, drawing, screen recording), and press **Approve** or **Request revisions**. Editors see the same room, so they see exactly what to change. Anyone in the review can **Download the video**.
6. **Variants.** If the script had several hooks, the editor delivers one cut per hook. You give each one a destination and caption in the Post tab.
7. **Ready to Post → With the VA.** Drag the card onto **With the VA**. A box shows every hook variant: choose **Trial reel** or **Main feed** and check its caption (each variant can have its own notes and cover, or share variant 1's caption). Press **Send to the VA**.
8. **The VA posts.** They open the card, see every variant on one page with the caption to copy, the cover, the file (or a QR code to send it to their phone), tick each **Posted**, and press **Mark as posted** (or drag to Posted). Something wrong? **Something not quite right?** sends it back to you with a note. You can also **Take it back** any time.
9. **Archive.** Posted videos move to the **Archive** and the video's files are filed in Google Drive: *Month → Video → Finished video / Raw footage / Script / Caption / Cover / Info*.

## Trial reels, then the feed

Everything is posted as a **trial reel** first. With **Publer** connected the VA posts it straight from the dashboard (**Post trial reel via Publer…**); without it, by hand in the Instagram app (Meta's own API can't post trials). Either way the VA (or you) types each trial's **views/likes** into the dashboard, and the Archive shows which one is winning with a **Post it to the main feed →** button. That opens a form with the caption — post now or schedule — and posts through Publer (or the Instagram connection). Feed posts bring their own numbers in automatically.

## The other places

- **Board** — Videos, Carousels, Scripting and Filming boards; drag cards between columns.
- **Calendar** — everything scheduled or posted, by day; filter by format or pillar; drag to reschedule.
- **Team** — each editor's work and pay, the copywriter's scripting pipeline, the VA's posting desk and tasks. Click a person to open their view.
- **Library** — Footage (b-roll), Music (drag and drop as many tracks as you like; **categorise the ones marked with a red !**), References, and the SOP / Playbook.
- **Analytics** — performance across videos.
- **Overview** — what needs your attention today.
- **Connect AI** (avatar menu) — connect your own Claude so it can list videos, write scripts, and move scripts between Ideation, Scripting and Script Review.

## Small rules that avoid problems

- While a file shows **Uploading… %**, keep the page open until it reaches 100%. After that you can close it.
- A video "with the VA" is only on the VA's board — moving it back (drag, **Take it back**, or **Later**) removes it from their desk.
- Nobody can sign themselves up; every login is created by the Owner or an Admin.

---

---

# 6 · Running it — costs, backups, updates, problems

## What it costs

| Service | Plan | Approx. per month |
|---|---|---|
| Vercel (hosting) | Pro | $20 |
| Supabase (database, logins, files) | Pro | $25 (includes daily backups) |
| Cloudflare Stream (video playback) | pay-as-you-go | ~$5 to start, grows with minutes of video stored and watched |
| Google Drive | your Google account | free (or your storage plan) |
| Groq, Telegram, Resend, cron-job.org, Meta | free tiers | $0 at this scale |
| Claude / ChatGPT (optional) | your own plans | already paying |

Check each provider's current pricing — these are approximate.

## Backups

- **Database:** Supabase Pro backs up daily and keeps 7 days. Restore: Supabase → **Database → Backups → Restore**. Point-in-time recovery is an optional paid add-on if you ever want minute-level restore.
- **Files:** finished videos and raw footage are archived to Google Drive when a video is marked posted. Music, references, comment attachments and carousel images live in Supabase Storage and are **not** in the database backups — keep originals of anything you can't recreate.
- **Team removal:** deactivating someone keeps their work; deleting a login is rarely needed.

## Keeping it up to date

Nathan pulls improvements from the master copy into your repo; Vercel redeploys on its own. If a release needs a database change it ships as a new `supabase/migration_NN_….sql` file — paste it into Supabase → SQL Editor → Run, once, in order.

## When something looks wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Everything is slow | Vercel region ≠ Supabase region | Set `"regions"` in `vercel.json` to match Supabase's region and redeploy |
| Can't sign in | Wrong/expired password | Owner → Team → **Reset password** |
| A video won't upload | File over the size limit | Raise the Supabase file limit and `NEXT_PUBLIC_MAX_UPLOAD_MB` to match |
| Video stuck "processing" | Nobody's page open and the 5-minute job isn't set up | Set up the cron-job.org jobs (`04`), or reopen the video page |
| Drive archive stops / **Test the connection** fails | The Google login was mistyped or revoked | Redo the Google Drive guide's last steps; take care copying the refresh token (the letter O and zero look alike) |
| Instagram channel missing in Post tab | Token or user ID not saved | Recheck the two Instagram fields in Settings, Save |
| Scheduled post didn't go out | The 5-minute job isn't running | Check the job at cron-job.org; its **Test run** must show `"ok":true` |
| No emails | Resend domain not verified, or the two variables missing | Finish `04` → Email; redeploy after adding the variables |
| Anything else | — | Vercel → your project → **Logs** shows the error; send Nathan a screenshot of it (never of Settings) |

## Security rules (short)

- **Never share:** the Supabase `service_role` key, Vercel environment variables, any Settings screenshot, anyone's password.
- **Sign-ups stay OFF** in Supabase (Authentication → Sign In / Providers). New people are added only from **Team → Seats**.
- Turn on **2-step login** for GitHub, Vercel, Supabase, Google, Meta and Cloudflare.
- When someone leaves: **Team → Deactivate**.
- Use long passwords (12+). Everyone can change theirs from the avatar menu.
- Don't paste keys into Claude/ChatGPT chat. The dashboard's setup prompts contain none — the AI is told to type values only into the Settings boxes.

## Who to contact

Nathan for anything the table above doesn't solve.
