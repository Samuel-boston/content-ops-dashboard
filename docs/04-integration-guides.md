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

## Publer — post and schedule Reels, including trial reels

The easy way to post from the dashboard: no Meta app or verification needed, and it can post Instagram trial reels, which Meta's own API cannot. Needs a Publer Business plan (check Publer's current pricing); it replaces the Meta / Instagram guide for posting.

### Steps

1. Go to publer.com and sign up or log in. Choose a Business plan — the API is not available on lower plans.
2. In Publer open Social Accounts → Add account → Instagram, and connect the Instagram account you post from. It must be a Professional (Creator or Business) account.
3. Open Settings → Access & Login → API Keys → Create API Key. Give it a name and tick these permissions: workspaces, accounts, posts and media. Create it and copy the key now.
4. In this dashboard open Settings → Publer, paste the key, and press Connect. It finds your workspace and Instagram account by itself; if you have more than one account it asks which to post to.

### Paste into Settings

- Publer → the API key box, then the Connect button (nothing else to fill in)

### Then

The Publer card turns green and says Connected to Instagram. Press “Test the connection” to check it. Then on any video that is with the VA, mark a variant as a trial reel and press “Post trial reel via Publer…”. Choose whether trial reels stay trials or may be shared by Instagram automatically at the top of the Publer card.

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

Save settings. Then, on any video that is Ready to Post, open the Post tab: the Instagram channel should now appear. Post a test to the feed to confirm.

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

Copywriters can list ideas, write scripts and move them between Ideation, Scripting and Script Review; owners and admins can do more.

