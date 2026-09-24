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
