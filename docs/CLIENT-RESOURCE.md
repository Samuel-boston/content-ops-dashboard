# Content Ops — your resource

Start with **3 · After the call**. Keep the rest for reference.

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
| 5 | **Publer** (or Instagram / Meta) | Post and schedule from the dashboard: Instagram Reels **including trial reels**, YouTube Shorts, TikTok, LinkedIn | Publer 15 min · Meta 1–2 hrs | Publer: no. Meta: **maybe — see below** |
| 6 | **Slack** | Ask the dashboard from Slack ("add this to ideas", "how many in scripting") and get updates in a channel | 10 min | No |
| 7 | **Email** (Resend) | "You were mentioned / revisions requested" emails | 20 min | **Yes — DNS** |
| 8 | **Your own Claude** | Work on scripts and run the board from inside Claude | 10 min each person | No |
| 9 | **Upload limit** (only if you skipped it on the call) | Cuts bigger than 50 MB | 5 min | No |

You can run the business without 5 to 8 — the VA can always post by hand from the Instagram app and tick Posted. Do 1–4 first. Publer (a paid Business plan) is the quickest way to post from the dashboard: no Meta app, no Meta verification, and it can post trial reels.

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

Recommended order: **Google Drive → Groq → scheduled jobs → Telegram → Publer (or Instagram) → Slack → email → your own Claude.** (Cloudflare Stream was done on the call.)

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

**Videos:** Ideation → Scripting → Ready to Film → Ready to Edit → Editing → In Review → Revisions (if changes) → *Awaiting Variants* (only if the script has several hooks) → Final Review → **With the VA** → Posted (goes to the Archive).

**Carousels:** Ideation → Scripting → Creatives → **With the VA** → Posted. When the creatives are done, one button sends it to the VA.

There is no Script Review and no Ready to Post: a script lives in Scripting until the owner or an admin moves it on, and **approving a cut (or Final Review) sends the video straight to the VA's desk** — nothing to click in between.

**Later:** any video, at any stage, can be shelved with the **Later** button (top of the video) and picked back up from **More → Later**. It leaves every board and count until you bring it back. Next to it is a **bin icon** that deletes a video for good, including its heavy files (owner and admins; it asks first).

**The Board** opens on **All videos**: videos and carousels together, every stage, in one view. **Carousels**, **Filming** and **Long-form** narrow it down. Long-form is for YouTube: give a video the format **Long video** and it appears there; the VA posts it to YouTube as a regular video (not a Short, never a trial reel).

**Every video, at every stage,** has a title, a **Thumbnail** (its own section: attach images from the B-Roll library or upload your own, write a brief, and ChatGPT designs it — or upload a finished one), a script and its video.

## Who does what

| Role | Sees | Does |
|---|---|---|
| **Owner** (you) | Everything, plus Settings | Approves scripts and cuts, sends videos to the VA, manages the team |
| **Admin** | Everything except Settings (the creative-director seat) | Approves, moves and deletes videos like the Owner; can't change integrations or add Admins |
| **Copywriter** | Ideation → Ready to Film on the Board | Writes scripts and hooks; taps **Script done** to tell the owner it is ready; can use Claude to draft |
| **Editor** | Only videos assigned to them, plus the pool to take on | Takes on a video, uploads the cut, submits for review, delivers hook variants, tracks their month and time off |
| **VA** | Posting board, Archive, Other tasks, Library, Time off | Posts videos, marks them posted, works through "Other" tasks |

## The everyday flow

1. **Idea.** Add it on the board (or send it to the Telegram bot from your phone — it lands in Ideation). Write the script, or let the copywriter do it.
2. **Scripting.** The copywriter writes and taps **Script done**; you get a notification, read it, comment on any part, and move it on (→ Ready to Film, or → Needs Creatives for a carousel).
3. **Film → editors.** Upload the raw footage (drag it onto the video), then send it on: the **editor brief** is not a stage, it is a menu that pops up whenever a video reaches Ready to Film or Ready to Edit — written notes, attachments, music tagged from the library — and send it to editors.
4. **Editing.** An editor takes it on (giving an ETA), uploads the cut, submits it. The upload box shows two steps: your file uploading (keep the page open) and Cloudflare preparing the video (you can close the page).
5. **Review.** You watch the cut, drop comments pinned to the exact moment (text, voice, drawing, screen recording), and press **Approve** or **Request revisions**. Editors see the same room, so they see exactly what to change. Anyone in the review can **Download the video**.
6. **Variants.** If the script had several hooks, the editor delivers one cut per hook. You give each one a destination and caption in the Post tab.
7. **Approve → With the VA.** Approving the cut (or Final Review) puts the video on the VA's desk automatically, every variant set to a trial reel by default. In the **Post** tab you can change a variant to the main feed, edit its caption, or add notes and a cover.
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
- **Library → Top posts** — the posts that worked: views, topic, hook and link. Add one by hand, paste a list, or let your own ChatGPT or Claude find good ones and add the ones you approve through the connector. Your own best posts are suggested automatically.
- **Monday research on autopilot** — put your offer and ideal client in **Library → SOP / Playbook** (a button on Top posts creates the two docs). Every Monday the digest carries a ready-made research prompt with **Open in ChatGPT** / **Open in Claude** buttons; one click starts a chat where the AI reads those docs, browses Instagram and the rest for what is working in your niche, and adds the winners to Top posts. Last week's finds show up in the next digest. You can also set a webhook (Zapier, Make, n8n) that gets the prompt every Monday, and connect ChatGPT (custom GPT Action) or Claude (skill) — all under Library → Top posts.
- **The Monday digest** (email, Telegram and Slack) now includes performance: the last 7 and 30 days, the best posts, and the individual **standouts** — posts far above (or well below) what a typical post gets.
- **Overview** — what needs your attention today.
- **Slack** — once connected (Settings → Slack) the team can type `/ops add idea …`, `/ops how many in scripting`, `/ops what's in review` in Slack, and the dashboard announces scripts done, cuts ready for review, approvals and posts in a channel.
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
