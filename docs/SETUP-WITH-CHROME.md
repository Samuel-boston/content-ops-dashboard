# Set this up with Claude in Chrome

One prompt for the Claude Chrome extension. It works entirely in the browser: no terminal needed. It copies the code into the Owner's own GitHub account, sets up Supabase, deploys on Vercel and checks the result.

It needs the code repo to be **public** while the copy is made (Vercel and GitHub can only copy a private repo for people who already have access). Nathan can make it private again afterwards.

## What the Owner does before pasting the prompt (10 minutes)

1. Create **GitHub**, **Vercel** and **Supabase** accounts on his own email and card. Turn on 2-step login for each.
2. Upgrade Vercel to **Pro**.
3. Install the Claude extension in Chrome, sign in, and stay logged in to GitHub, Vercel and Supabase in that same Chrome.

## What Claude cannot do (the Owner does these when Claude asks)

- Create accounts, enter card details, or upgrade to a paid plan.
- Log in, pass 2-step login codes, or solve captchas.
- Type or choose passwords (the database password, the Owner's own password).
- Change the Supabase security switches. Claude points to them and the Owner clicks them.

## The prompt

```
You are setting up my own copy of a content-operations dashboard, using my browser. I am the Owner. Everything is created under MY accounts. Work through the steps below in order, and after each one tell me in one line what you did and check it worked before you move on.

Rules:
- Never create accounts, enter card details, choose or type a password, or handle a verification code. When a step needs one of these, stop and tell me exactly what to do, then wait until I say I have done it.
- Never write a secret key into this chat. When a step tells you to copy a secret (the Supabase service_role key), copy it straight from the Supabase page into the Vercel field and do not repeat it back to me.
- Do not change anything that is not in these steps.
- If something on screen is different from what I describe, say so and ask me. Do not guess.

The code is at https://github.com/Samuel-boston/content-ops-dashboard (public). The database file is https://raw.githubusercontent.com/Samuel-boston/content-ops-dashboard/main/supabase/setup_all.sql

STEP 1. Supabase project. Open supabase.com/dashboard. Ask me which country the team is mainly in. Then create a new project named "content-ops" in the closest region (UK: London, eu-west-2; Europe: Frankfurt; US: East or West). Ask me to type the database password myself and save it in a password manager. Wait until the project is ready. Then ask me to upgrade the project to Pro under Project Settings > Billing, and wait until I confirm.

STEP 2. Database. Open the database file link above in a new tab, select all the text and copy it. In the Supabase project open SQL Editor > New query, paste it, and press Run. If Supabase shows a "destructive operation" warning, that is expected because the database is empty: confirm it. The result must say Success. If pasting fails or the result shows an error, quote the error to me exactly and stop. Run the file once only.

STEP 3. Login safety switches. Open Authentication > Sign In / Providers. Show me where "Allow new users to sign up" is and ask me to turn it OFF, and to turn "Confirm email" OFF, then press Save changes. The switch does nothing until Save is pressed. Then open the password settings and ask me to set the minimum password length to 12 and save. Wait until I confirm each one. Afterwards reload the page and check that the switches still show the values I set.

STEP 4. Upload size. Open Storage > Settings (or the global file size limit setting) and set the limit to 500 MB. If it cannot be set from the page, ask me to do it.

STEP 5. Copy the code to my GitHub and deploy. Open this address, which copies the code into my GitHub account and starts a Vercel deploy:
https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FSamuel-boston%2Fcontent-ops-dashboard
Choose my GitHub account, name the new repository "content-ops", and make it PRIVATE. If GitHub or Vercel asks me to authorise something, tell me what it is asking and wait for my approval. If this address does not work, instead fork the repository on GitHub into my account, make the fork private if allowed, and then in Vercel choose Add New > Project and import it.
Before you deploy, add these Production environment variables:
- NEXT_PUBLIC_SUPABASE_URL: the Project URL, from Supabase > Project Settings > API.
- NEXT_PUBLIC_SUPABASE_ANON_KEY: the "anon public" key, same page.
- SUPABASE_SERVICE_ROLE_KEY: the "service_role" key, same page. Copy it directly from the page into the field. Do not show it to me.
- CRON_SECRET: ask me to type a long random string of at least 30 characters (or paste one from my password manager) and to save it, because I need it later.
- NEXT_PUBLIC_MAX_UPLOAD_MB: 500
Deploy. When it finishes, note the site address (for example https://content-ops-abc.vercel.app). Then add one more Production variable, NEXT_PUBLIC_APP_URL, set to that address with no trailing slash, and redeploy (Deployments > the latest one > Redeploy). Open the address and check the login page loads.

STEP 6. Region check. In my GitHub repository "content-ops" open vercel.json. The "regions" value must match my Supabase region: London lhr1, Frankfurt fra1, US East iad1, US West sfo1. If it does not, edit the file on GitHub to the right value and commit. Vercel will redeploy by itself.

STEP 7. My Owner login. In Supabase open Authentication > Users > Add user > Create new user. Fill in my email, tick "Auto Confirm User", and ask me to type the password myself (at least 12 characters). Then open SQL Editor > New query, paste this with my real email and full name filled in, and run it:

update auth.users
set raw_app_meta_data = raw_app_meta_data || '{"role":"owner","invited":true}'::jsonb,
    raw_user_meta_data = raw_user_meta_data || '{"full_name":"MY FULL NAME"}'::jsonb
where email = 'MY EMAIL';

Then ask me to sign in on the site, open the avatar menu > Change password, and set a new password that only I know.

STEP 8. Check. With me signed in, confirm: the dashboard loads, Settings opens (avatar menu > Settings), and Team > Seats opens. Then check that strangers cannot sign up: on the login page there must be no way to create an account.

STEP 9. Finish. Tell me the site address. Remind me to save: the database password, the CRON_SECRET, and my password. Remind me that Nathan will make the code repository private again, and that the next job is the integrations checklist (Settings > Set up your integrations).
```

## What is left after the prompt

- **Cloudflare Stream** (video playback): account and card are the Owner's; then paste three values into Settings. Claude in Chrome can do this from the guide in Settings.
- **Google Drive, Groq, Telegram, cron-job.org:** each has a guide in Settings > Set up your integrations that Claude in Chrome can follow. The Owner logs in, and types or approves anything secret.
- **Instagram / Meta and email (Resend):** the Owner's identity checks and DNS changes are slow and not the Owner's fault. Post by hand and rely on in-app notifications until they clear.
- **Team logins:** the Owner adds each person under Team > Seats.
