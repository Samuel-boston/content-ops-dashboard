/**
 * The setup guides shown in Settings. One place holds the steps for every integration, so the
 * manual instructions and the prompts handed to Claude / ChatGPT can never drift apart.
 *
 * `fields` are the exact labels of the boxes in this dashboard's Settings the values go into.
 */
export interface SetupGuideItem {
  id: string;
  title: string;
  /** One line: what it's for and roughly what it costs. */
  blurb: string;
  /** The manual steps, in order. `{app}` is replaced with the dashboard's address. */
  steps: string[];
  /** Where the results go, in Settings. */
  fields: string[];
  /** What to do once the values are in. */
  finish: string;
}

export const SETUP_GUIDES: SetupGuideItem[] = [
  {
    id: "stream",
    title: "Cloudflare Stream — video playback and review",
    blurb: "Plays and reviews finished cuts. Pay-as-you-go: roughly $5 per 1,000 minutes stored and $1 per 1,000 delivered (check Cloudflare's current pricing).",
    steps: [
      "Go to dash.cloudflare.com and sign up or log in.",
      "In the left menu open Stream (under Media) and subscribe to Stream. Leave Cloudflare Images unchecked — it isn't used.",
      "Copy the Account ID (shown on the Stream page and in the dashboard URL).",
      "Open My Profile → API Tokens → Create Token → Create Custom Token. Give it the permission Account · Stream · Edit, for your account only. Create it and copy the token now — it is only shown once.",
      "Upload any short test video in Stream and open it. Its playback links look like customer-abc123.cloudflarestream.com — copy the part after “customer-” (abc123).",
    ],
    fields: ["Cloudflare Stream → Account ID", "Cloudflare Stream → API token", "Cloudflare Stream → Customer subdomain code"],
    finish: "Save settings, then upload a cut on any video in the dashboard and check it plays.",
  },
  {
    id: "drive",
    title: "Google Drive — the permanent archive",
    blurb: "Stores raw footage, finished videos and the posted archive. Free with a Google account. These steps make the login permanent (it does not expire after 7 days).",
    steps: [
      "In Google Drive create a folder for the archive (for example “Content Ops”). Open it and copy the folder ID — the long code at the end of the address (…/folders/THIS-PART).",
      "Go to console.cloud.google.com and create a new project (any name).",
      "APIs & Services → Library → search “Google Drive API” → Enable.",
      "APIs & Services → OAuth consent screen (Google Auth Platform) → set it up as External, add your own email, then press “Publish app” so its status is In production. This is what stops the login expiring after 7 days. Ignore any “unverified app” warning — it's your own app.",
      "APIs & Services → Credentials → Create Credentials → OAuth client ID → type Web application. Under Authorised redirect URIs add exactly: https://developers.google.com/oauthplayground . Create it and copy the Client ID and Client secret.",
      "Open developers.google.com/oauthplayground. Click the gear icon (top right), tick “Use your own OAuth credentials”, and paste the Client ID and Client secret.",
      "In Step 1 type the scope https://www.googleapis.com/auth/drive into the box, press Authorise APIs, and sign in with the Google account that owns the folder (Continue through the unverified-app screen).",
      "In Step 2 press “Exchange authorization code for tokens” and copy the Refresh token (starts with 1//).",
      "Build the login JSON (see “Google login JSON” below) and paste it into Settings.",
    ],
    fields: [
      "Google Drive → Target folder ID  (the folder ID from step 1)",
      "Google Drive → Google login JSON  (paste exactly: {\"type\":\"authorized_user\",\"client_id\":\"…\",\"client_secret\":\"…\",\"refresh_token\":\"…\"} with your three values)",
    ],
    finish: "Save settings, then press “Test the connection” — it must say Connected. Careful copying the refresh token: letters O and zero look alike.",
  },
  {
    id: "publer",
    title: "Publer — post to Instagram (including trial reels), YouTube, TikTok and LinkedIn",
    blurb: "The easy way to post from the dashboard: no Meta app or verification needed, and it can post Instagram trial reels, which Meta's own API cannot. Needs a Publer Business plan (check Publer's current pricing); it replaces the Meta / Instagram guide for posting.",
    steps: [
      "Go to publer.com and sign up or log in. Choose a Business plan — the API is not available on lower plans.",
      "In Publer open Social Accounts → Add account, and connect each account you post from: Instagram (a Professional Creator or Business account), YouTube, TikTok and/or LinkedIn.",
      "Open Settings → Access & Login → API Keys → Create API Key. Give it a name and tick these permissions: workspaces, accounts, posts and media. Create it and copy the key now.",
      "In this dashboard open Settings → Publer, paste the key, and press Connect. It finds your workspace and accounts by itself; if you have more than one of a kind it asks which to post to.",
    ],
    fields: ["Publer → the API key box, then the Connect button (nothing else to fill in)"],
    finish: "The Publer card turns green and lists each connected account. Press “Test the connection” to check it. Then on any video that is with the VA, mark a variant as a trial reel and press “Post trial reel via Publer…”. Choose whether trial reels stay trials or may be shared by Instagram automatically at the top of the Publer card.",
  },
  {
    id: "instagram",
    title: "Meta / Instagram — analytics and posting",
    blurb: "Lets the dashboard post and schedule Reels and carousels to the feed and read their numbers. Free. Meta's own API cannot post trial reels — use the Publer guide above if you want those posted from the dashboard.",
    steps: [
      "Make sure the Instagram account is a Professional account (Creator or Business) and is linked to a Facebook Page you manage.",
      "Go to business.facebook.com and create (or open) the Business portfolio that owns that Page and Instagram account.",
      "Go to developers.facebook.com → My Apps → Create App → type Business. Add the product “Instagram” (Instagram API with Facebook Login) and connect the app to the same Business portfolio.",
      "In business.facebook.com → Settings → Users → System users, add a system user (role Admin). Assign it the app (full control) and the Page and Instagram account (full control).",
      "Generate a token for that system user: pick your app, set expiry to Never, and tick these permissions: instagram_basic, instagram_content_publish, instagram_manage_insights, pages_show_list, pages_read_engagement, business_management. Copy the token — it is shown once, and unlike a normal token it does not expire every 60 days.",
      "Find the Instagram user ID: in Graph API Explorer with that token call  me/accounts?fields=instagram_business_account  and copy the instagram_business_account id (a long number).",
      "The app can stay in Development mode — it only ever posts to your own account, so Meta app review is not needed.",
    ],
    fields: ["Instagram Graph API → IG Business/Creator user ID", "Instagram Graph API → Long-lived access token"],
    finish: "Save settings. Then, on any video that is with the VA, open the Post tab: the Instagram channel should now appear. Post a test to the feed to confirm.",
  },
  {
    id: "groq",
    title: "Groq — free AI for transcription and idea sorting",
    blurb: "Powers voice-note transcription and sorting ideas that arrive from Telegram. The free tier has daily limits that comfortably cover one small team; no card is needed.",
    steps: [
      "Go to console.groq.com and sign up or log in.",
      "Open API Keys → Create API Key, name it “Content Ops”, and copy it (shown once).",
    ],
    fields: ["AI scripting → Engine: choose Groq", "AI scripting → Groq API key"],
    finish: "Save settings. Send a short voice note to the Telegram bot (if set up) and check the idea arrives with a transcript.",
  },
  {
    id: "telegram",
    title: "Telegram — capture ideas from your phone",
    blurb: "Anything sent to a private Telegram chat lands in Ideation. Free.",
    steps: [
      "In Telegram open a chat with @BotFather, send /newbot, choose a name and a username, and copy the bot token it gives you.",
      "Create a private group (or use a private chat with the bot) and add the bot to it. Send any message in it.",
      "Find the chat ID: in a browser open https://api.telegram.org/bot<YOUR-TOKEN>/getUpdates (replace <YOUR-TOKEN>), and look for  \"chat\":{\"id\": …}  — a number, negative for groups. Copy it.",
      "Register the webhook by opening this address in a browser (replace <YOUR-TOKEN>):  https://api.telegram.org/bot<YOUR-TOKEN>/setWebhook?url={app}/api/telegram/webhook  — it should answer {\"ok\":true}.",
    ],
    fields: ["Telegram automations → Bot token", "Telegram automations → Authorised chat IDs"],
    finish: "Save settings, then send a text message to the chat — a new idea should appear in Ideation within seconds.",
  },
  {
    id: "email",
    title: "Email notifications (Resend)",
    blurb: "Sends the “you've been mentioned / revisions requested” emails. Free tier is plenty. These two values are set in Vercel, not in this page.",
    steps: [
      "Go to resend.com, sign up, and add your sending domain (Domains → Add Domain). Add the DNS records it shows at your domain provider and press Verify.",
      "API Keys → Create API Key (Sending access) and copy it.",
      "In Vercel open the project → Settings → Environment Variables and add RESEND_API_KEY (the key) and RESEND_FROM_EMAIL (for example  Content Ops <notifications@yourdomain.com>). Apply to Production.",
      "Redeploy the project (Deployments → the latest → Redeploy) so the new values load.",
    ],
    fields: ["Vercel environment variable RESEND_API_KEY", "Vercel environment variable RESEND_FROM_EMAIL"],
    finish: "Mention a teammate in a video comment and check the email arrives.",
  },
  {
    id: "cron",
    title: "Scheduled jobs (cron-job.org) — so scheduled posts go out on time",
    blurb: "Vercel's own free schedule only runs once a day. This free service calls the dashboard every 5 minutes so scheduled Instagram posts and finished uploads are picked up promptly.",
    steps: [
      "In Vercel → Settings → Environment Variables make sure CRON_SECRET is set to a long random string (30+ characters). Copy it.",
      "Go to cron-job.org, sign up, and choose Create cronjob.",
      "Job 1 — URL:  {app}/api/cron/publish?key=YOUR-CRON-SECRET  — schedule: every 5 minutes.",
      "Job 2 — URL:  {app}/api/cron?key=YOUR-CRON-SECRET  — schedule: once a day.",
    ],
    fields: ["Two cron-job.org jobs (nothing to paste into Settings)"],
    finish: "Use the “Test run” button on each job — the response should be JSON containing  \"ok\":true.",
  },
  {
    id: "claude",
    title: "Connect your own Claude (each team member, optional)",
    blurb: "Lets someone work on scripts or run the board from inside Claude. Uses their existing Claude plan — no extra cost.",
    steps: [
      "Sign in to the dashboard as that person, open the account menu (top right) and choose Connect AI.",
      "Press Generate token, name it, and copy the token (shown once).",
      "In Claude (claude.ai or the desktop app) open Settings → Connectors → Add custom connector. Paste the Server URL shown on the Connect AI page and the token as instructed there.",
      "In a chat, ask “what videos are in ideation?” to confirm it can see the board.",
    ],
    fields: ["Done per person, on the Connect AI page"],
    finish: "Copywriters can list ideas, write scripts and move them between Ideation and Scripting; owners and admins can do more.",
  },
];

export type SetupMode = "claude" | "chatgpt" | "manual";

/** The instruction handed to an AI that can drive the browser. */
export function buildPrompt(g: SetupGuideItem, mode: Exclude<SetupMode, "manual">, app: string): string {
  const steps = g.steps.map((s, i) => `${i + 1}. ${s.replaceAll("{app}", app)}`).join("\n");
  const tool = mode === "claude" ? "your browser tools (the Claude in Chrome extension)" : "your computer/browser control";
  return `You are helping me set up the "${g.title}" integration for my content dashboard at ${app}.
I am already signed in to the dashboard in this browser as the Owner. Use ${tool} to do this for me, step by step.

Rules:
- If you reach a login, two-step verification, CAPTCHA, or a payment / billing screen, stop and hand control back to me. Carry on when I say so.
- Never type my passwords. Never buy, upgrade or subscribe to anything without asking me first.
- Do not paste keys, tokens or secrets into this chat or anywhere except the dashboard box named below.
- Before anything you can't easily undo, say what you're about to do.

What to do:
${steps}

Where the results go — open ${app}/settings and paste each value into its box:
${g.fields.map((f) => `- ${f}`).join("\n")}

Finish: ${g.finish}
Then tell me plainly what you did, what worked, and anything I still need to do by hand.`;
}
