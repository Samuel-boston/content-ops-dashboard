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
