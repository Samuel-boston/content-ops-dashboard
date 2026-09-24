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
