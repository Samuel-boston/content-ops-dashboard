# 1 · Before the call — Nathan

Goal: on the call nothing should be a surprise. Do this the day before.

## A. Dry run (do this once per client — 45 min)

This proves the copy works on brand-new accounts. The one thing nobody has ever tested is the one-file database setup on an empty Supabase project.

1. Create a **throwaway Supabase project** (free plan is fine for this). Note the three values from Project Settings → API: Project URL, anon key, service_role key.
2. Supabase → SQL Editor → paste all of `supabase/setup_all.sql` → Run. It should end with "Success". Confirm any "destructive operation" warning (empty database).
3. Authentication → Sign In / Providers → **Allow new users to sign up: OFF → Save changes**.
4. Create a throwaway Vercel project from the copy (step B below), add the environment variables listed in `02-on-the-call.md` §4, deploy.
5. Create the Owner login using the SQL in `02-on-the-call.md` §5, sign in, create a test idea, move it along a few stages.
6. If anything fails, fix it in the **master** repo and re-copy. Delete the throwaway Supabase and Vercel projects afterwards.

## B. Make Adam's copy (your master stays untouched)

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

## C. Set the hosting region

Open `vercel.json` in the copy. Set `"regions"` to the Vercel region closest to **his Supabase region**:

| His Supabase region | Vercel region |
|---|---|
| London / eu-west-2 | `lhr1` |
| Frankfurt / eu-central-1 | `fra1` |
| US East (N. Virginia) | `iad1` |
| US West | `sfo1` |

Wrong region = every click takes seconds instead of milliseconds (this was the "it's so slow" problem). Commit and push.

## D. Tell Adam what to have ready

- A card (three subscriptions: Vercel Pro, Supabase Pro, Cloudflare Stream).
- His Google account, Instagram login, and his email inbox (verification codes).
- Chrome installed (needed for the Claude / ChatGPT auto-setup option).
- ~90 minutes, no interruptions.

## E. Checklist

- [ ] Dry run passed
- [ ] Copy pushed to Adam's GitHub, you have access
- [ ] `vercel.json` region set
- [ ] Adam has told you which email he'll use for everything
