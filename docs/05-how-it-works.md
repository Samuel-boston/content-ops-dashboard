# 5 · How it works day to day

## The idea in one line

Every video is a card that moves left to right through stages. Each person only sees the stages that are theirs, and every move tells the next person it's their turn.

## The stages

**Videos:** Ideation → Scripting → Ready to Film → Ready to Edit → Editing → In Review → Revisions (if changes) → *Awaiting Variants* (only if the script has several hooks) → Final Review → **With the VA** → Posted (goes to the Archive).

**Carousels:** Ideation → Scripting → Creatives → **With the VA** → Posted. When the creatives are done, one button sends it to the VA.

There is no Script Review and no Ready to Post: a script lives in Scripting until the owner or an admin moves it on, and **approving a cut (or Final Review) sends the video straight to the VA's desk** — nothing to click in between.

**Later:** any video, at any stage, can be shelved with the **Later** button (top of the video) and picked back up from **More → Later**. It leaves every board and count until you bring it back. Next to it is a **bin icon** that deletes a video for good, including its heavy files (owner and admins; it asks first).

**The Board** opens on **All Content**: videos and carousels together, every stage, in one view. **Carousels**, **Filming** and **Long-form** narrow it down. Long-form is for YouTube: give a video the format **Long video** and it appears there; the VA posts it to YouTube as a regular video (not a Short, never a trial reel).

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
- **Library** — B-roll (browse the folders, search what is in the shot, or paste a script and get clips for each line), Music (drag and drop as many tracks as you like; **categorise the ones marked with a red !**), References, and the SOP / Playbook.
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
