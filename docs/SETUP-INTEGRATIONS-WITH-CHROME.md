# Connect the integrations with Claude in Chrome

Second prompt, used after the main setup (`SETUP-WITH-CHROME.md`) is finished and the Owner can sign in to the dashboard. It works through the integration guides one after another and does the clicking. The Owner does the logins, cards, codes and anything secret.

The step-by-step instructions for each service are in `04-integration-guides.md` (the same guides are inside the dashboard under Settings > Set up your integrations). The prompt tells Claude to read them from there, so there is only one copy to keep up to date.

## The prompt

```
I have my own content-operations dashboard running and I am signed in to it as the Owner. Now I want to connect its integrations, in this order: Google Drive, Groq, scheduled jobs (cron-job.org), Telegram, Cloudflare Stream (if not done yet), Publer (I have or will get a Publer Business plan; if not, use Instagram / Meta instead), then email (Resend).

The step-by-step guides are in this file: https://github.com/Samuel-boston/content-ops-dashboard/blob/main/docs/04-integration-guides.md
Open it and read it. Do one integration at a time, following its guide exactly. My dashboard address is: [PASTE MY SITE ADDRESS HERE]

How to work:
- Before each integration, tell me in one line what you are about to set up and what you need from me. After it, check it works using the "Then" test in the guide, and tell me the result in one line before you start the next one.
- Values go into the boxes on my dashboard's Settings page (avatar menu > Settings) and are saved with Save settings. The email keys (RESEND_API_KEY, RESEND_FROM_EMAIL) and CRON_SECRET are Vercel environment variables instead: add them under my Vercel project > Settings > Environment Variables (Production) and then redeploy.
- Never create accounts, enter card details, choose or type a password, or handle a verification code, captcha or 2-step login. When a step needs one, stop, tell me exactly what to do, and wait until I say it is done.
- When a step creates a secret (an API token, a client secret, a refresh token, a bot token), copy it straight from the page where it appears into the box where it belongs. Do not repeat it in this chat.
- Some steps are slow and are not my fault: Meta business verification, email DNS records, and Google's "unverified app" screen. If one stalls, tell me what is waiting and what happens if I leave it. Then skip to the next integration and come back to it at the end.
- If the screen differs from the guide, say so and ask me. Do not guess. Do not change anything that is not in the guides.

At the end, give me a list: each integration marked Done, Waiting (and on what) or Skipped, and what I still need to do myself.
```

## What Claude can and cannot do here

| Integration | Claude can | The Owner must |
| --- | --- | --- |
| Google Drive | Create the Google Cloud project, enable the Drive API, set the consent screen, create the OAuth client, run the OAuth Playground steps, paste the values | Sign in to Google, approve the consent, click through the "unverified app" warning |
| Groq | Create the API key, paste it, choose Groq as the engine | Sign up or log in |
| Scheduled jobs | Create both jobs on cron-job.org with the right addresses and schedules, run the test | Sign up or log in; give a long `CRON_SECRET` if not already set |
| Telegram | Open @BotFather, make the bot, find the chat ID, register the webhook, paste values | Log in to Telegram (phone login and code); send the first message in the group |
| Cloudflare Stream | Copy the account ID, create the API token, find the subdomain code, paste the values | Sign up, subscribe with a card |
| Publer | Add the Instagram account in Publer, create the API key with the workspaces, accounts, posts and media permissions, paste it in Settings → Publer and press Connect | Sign up, choose a Business plan with a card, log in to Instagram when Publer asks to connect the account |
| Instagram / Meta (only if not using Publer) | Create the app and system user, set permissions, find the account ID | Log in to Facebook, identity or business verification, approve every permission and token screen |
| Email (Resend) | Add the domain, create the key, set the Vercel variables, redeploy | Sign up; add the DNS records at his domain provider (or give Claude access), then wait for verification |
| Each person's own Claude | Nothing: it is per person | Each person generates their own token on the Connect AI page and adds the connector in their own Claude |

## Things nobody can do for the Owner

- Card details and paid plans.
- Passwords, 2-step codes, captchas, phone verification.
- Meta and Google identity or business checks, and the waiting time on them.
- DNS changes at a domain provider Claude has no access to.
- Anything that needs the phone (Telegram login, Instagram app).
- Trial reels: only Publer can post them from the dashboard. Without Publer, the VA posts trial reels by hand in the Instagram app.
