"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import {
  trialPostingKitAction,
  vaCancelScheduledAction,
  vaMarkTrialPostedAction,
  vaPublishAction,
  variantPhoneTokenAction,
  vaSaveTrialMetricsAction,
  vaSaveLinkAction,
  vaSendBackAction,
  vaSetVariantStateAction,
  type PostingJobItem,
  type PostingTrialItem,
} from "@/app/posting-actions";
import { IconCheck, IconClock } from "@/components/ui/icons";
import { QR } from "@/components/ui/QR";
import { PostComposer, type ComposerSubmit } from "@/components/posting/PostComposer";
import { CHOICE_LABELS, variantChoice, variantStateLabel, type VariantChoice } from "@/lib/variant-state";
import type { Role } from "@/lib/types";

/**
 * One variant inside a video's card: a row you click to open, and inside it
 * everything needed to post it and nothing else:
 * get the file, copy the caption, post from the IG app as a trial, paste the
 * permalink back. Once live, the card flips to a numbers form — the trial's
 * insights only exist inside the IG app, so someone has to carry them over.
 */
function VariantPanel({
  trial,
  open,
  onToggle,
  instagramConnected,
  clientName,
}: {
  trial: PostingTrialItem;
  open: boolean;
  onToggle: () => void;
  instagramConnected: boolean;
  clientName: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();
  const [permalink, setPermalink] = useState(trial.permalink ?? "");
  const [composing, setComposing] = useState(false);
  const [draftCaption, setDraftCaption] = useState(trial.caption ?? "");
  const [phoneUrl, setPhoneUrl] = useState<string | null>(null);
  const [m, setM] = useState({
    views: trial.views?.toString() ?? "",
    likes: trial.likes?.toString() ?? "",
    comments: trial.comments?.toString() ?? "",
    shares: trial.shares?.toString() ?? "",
    saves: trial.saves?.toString() ?? "",
  });
  // Frozen at mount on purpose: "overdue" needn't tick over mid-visit, and
  // render-time Date.now() trips the purity rule.
  const [now] = useState(() => Date.now());

  const due =
    trial.scheduled_for &&
    new Date(trial.scheduled_for).getTime() < now &&
    trial.status === "planned";

  function getKit() {
    if (trial.images?.length) {
      // A carousel: no video file, just its slide images — one download each.
      trial.images.forEach((u, i) => setTimeout(() => window.open(u, "_blank", "noopener"), i * 250));
      return;
    }
    startTransition(async () => {
      const res = await trialPostingKitAction(trial.id);
      if ("error" in res) return toast.error(res.error);
      if (res.downloadUrl) {
        if (!res.original) {
          toast.info(
            "Heads up: this is Cloudflare's re-encoded copy, so it's smaller than what was uploaded. Ask for the original to be re-uploaded if quality matters."
          );
        }
        window.open(res.downloadUrl, "_blank", "noopener");
      } else {
        toast.error("No downloadable file for this cut yet — ask the team.");
      }
    });
  }

  function showPhoneCode() {
    startTransition(async () => {
      const { token } = await variantPhoneTokenAction(trial.id);
      setPhoneUrl(`${window.location.origin}/api/variant/${token}`);
    });
  }

  function publish(v: ComposerSubmit) {
    startTransition(async () => {
      const res = await vaPublishAction(trial.id, {
        whenISO: v.whenISO,
        caption: v.caption,
        coverOffsetMs: v.coverOffsetMs,
        shareToFeed: v.shareToFeed,
      });
      if (res?.error) toast.error(res.error);
      else {
        toast.success(res.scheduled ? "Scheduled — it'll go out by itself." : "Posted to Instagram ✓");
        router.refresh();
      }
    });
  }

  function copyCaption() {
    if (!trial.caption) return toast.error("No caption written for this one.");
    navigator.clipboard
      .writeText(trial.caption)
      .then(() => toast.success("Caption copied."))
      .catch(() => toast.error("Couldn't copy — select it by hand."));
  }

  function markPosted() {
    startTransition(async () => {
      const res = await vaMarkTrialPostedAction(trial.id, permalink);
      if (res?.error) toast.error(res.error);
      else {
        toast.success(
          res.finished
            ? "Posted ✓ — it's on the calendar and moving to the archive."
            : "Posted ✓ — come back for the numbers once Instagram shows them."
        );
        router.refresh();
      }
    });
  }

  function saveMetrics() {
    startTransition(async () => {
      const num = (s: string) => (s.trim() === "" ? null : Number(s));
      const res = await vaSaveTrialMetricsAction(trial.id, {
        views: num(m.views),
        likes: num(m.likes),
        comments: num(m.comments),
        shares: num(m.shares),
        saves: num(m.saves),
      });
      if (res?.error) toast.error(res.error);
      else {
        toast.success("Numbers saved.");
        router.refresh();
      }
    });
  }

  const field =
    "w-full rounded-md border border-line bg-raised px-2 py-1.5 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none";

  const choice = variantChoice({ status: trial.status, post_as: trial.postAs });
  const posted = trial.status !== "planned";

  function setChoice(next: VariantChoice) {
    startTransition(async () => {
      const res = await vaSetVariantStateAction(trial.id, next, permalink || undefined);
      if (res?.error) toast.error(res.error);
      else {
        if (next === "posted_main") {
          toast.success(
            res.linked
              ? "Recorded as posted to the main feed — connected to its analytics."
              : "Recorded as posted to the main feed."
          );
        }
        router.refresh();
      }
    });
  }

  function undoPosted() {
    startTransition(async () => {
      const res = await vaSetVariantStateAction(trial.id, "to_post");
      if (res?.error) toast.error(res.error);
      else router.refresh();
    });
  }

  function saveLink() {
    startTransition(async () => {
      const res = await vaSaveLinkAction(trial.id, permalink);
      if (res?.error) toast.error(res.error);
      else {
        toast.success(res.linked ? "Link saved — connected to its analytics." : "Link saved.");
        router.refresh();
      }
    });
  }

  return (
    <div className={`rounded-xl border bg-card p-3 ${open ? "border-accent/50" : "border-line"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="text-ink-3">{open ? "▾" : "▸"}</span>
          <span className="min-w-0 truncate text-sm font-medium">{trial.label}</span>
          {trial.winner ? <span title="Winning hook">🏆</span> : null}
        </button>
        <select
          value={choice}
          disabled={pending}
          onChange={(e) => setChoice(e.target.value as VariantChoice)}
          aria-label="Post as"
          className="rounded-md border border-line bg-raised px-2 py-1 text-xs focus:border-accent focus:outline-none"
        >
          <option value="trial">{CHOICE_LABELS.trial}</option>
          {!posted ? <option value="main">{CHOICE_LABELS.main}</option> : null}
          <option value="posted_main">{CHOICE_LABELS.posted_main}</option>
        </select>
        <span
          className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            trial.status === "planned"
              ? due
                ? "bg-red-500/15 text-red-400"
                : "bg-amber-500/15 text-amber-400"
              : trial.onMainFeed
                ? "bg-sky-500/15 text-sky-400"
                : "bg-emerald-500/15 text-emerald-400"
          }`}
        >
          {trial.status === "planned" ? (due ? "Overdue" : trial.scheduled_for ? "To post" : "To post") : variantStateLabel({ status: trial.status, post_as: trial.postAs })}
        </span>
      </div>

      {open ? (
      <>
      {trial.notes ? (
        <p className="mt-2 whitespace-pre-wrap rounded-md border border-line bg-raised px-2.5 py-2 text-xs leading-relaxed text-ink-2">
          <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-ink-3">
            Instructions
          </span>
          {trial.notes}
        </p>
      ) : null}
      {trial.coverUrl ? (
        <a
          href={trial.coverUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 flex items-center gap-2 text-xs text-accent-hi hover:underline"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={trial.coverUrl} alt="Cover" className="h-14 w-14 rounded-md object-cover" />
          Cover image — open to save
        </a>
      ) : null}
      <p className="mt-1 text-xs text-ink-2">
        {trial.scheduled_for ? (
          <span className="ml-2 inline-flex items-center gap-1 text-ink-3">
            <IconClock size={11} />
            {new Date(trial.scheduled_for).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
          </span>
        ) : null}
      </p>

      {trial.caption ? (
        <p className="mt-2 line-clamp-2 rounded-md bg-raised px-2 py-1.5 text-xs leading-relaxed text-ink-2">
          {trial.caption}
        </p>
      ) : null}

      {trial.status === "planned" ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={getKit}
              disabled={pending}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hi disabled:opacity-50"
            >
              {trial.images?.length ? `Download the images (${trial.images.length})` : "Download the video"}
            </button>
            <button
              onClick={showPhoneCode}
              disabled={pending}
              title="Scan with your phone to download it there, with the caption"
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
            >
              Send to my phone (QR)
            </button>
            <button
              onClick={copyCaption}
              disabled={pending}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
            >
              Copy caption
            </button>
          </div>
          {phoneUrl ? (
            <div className="flex items-center gap-3 rounded-lg border border-line bg-raised p-2.5">
              <QR url={phoneUrl} size={140} />
              <div className="min-w-0 text-[11px] leading-relaxed text-ink-3">
                <p className="text-ink-2">Scan with your phone.</p>
                <p>It opens a page with the download and the caption to paste. The code works for 6 hours.</p>
                <button
                  type="button"
                  onClick={() => setPhoneUrl(null)}
                  className="mt-1 text-ink-3 underline hover:text-ink-2"
                >
                  Hide
                </button>
              </div>
            </div>
          ) : null}
          {trial.postAs === "main" ? (
            <div className="rounded-xl border border-accent/30 bg-accent-ghost/40 p-2.5">
              <button
                type="button"
                onClick={() => setComposing((v) => !v)}
                className="flex w-full items-center justify-between text-left text-xs font-medium text-ink"
              >
                <span>Post or schedule this on Instagram…</span>
                <span className="text-ink-3">{composing ? "Close" : "Open"}</span>
              </button>
              {composing ? (
                <div className="mt-3">
                  <PostComposer
                    caption={draftCaption}
                    onCaptionChange={setDraftCaption}
                    connected={instagramConnected ? ["instagram"] : []}
                    emptyHint={
                      <>
                        {clientName} connects channels once in Settings → Integrations — after that
                        they show up here to post and schedule from. Until then, post it by hand and
                        mark it posted below.
                      </>
                    }
                    isVideo={!trial.images?.length}
                    durationSeconds={trial.durationSeconds}
                    pending={pending}
                    onSubmit={publish}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-[11px] leading-relaxed text-ink-3">
              {trial.images?.length ? (
                <>Post the images as a <b>carousel</b> from the Instagram app, using the caption above.</>
              ) : (
                <>
                  Post it from the Instagram app as a <b>trial reel</b> (Share to: Trial), using the
                  caption above.
                </>
              )}
            </p>
          )}
          <div className="rounded-lg border border-line p-2.5">
            <p className="mb-1.5 text-[11px] text-ink-3">
              Posted it by hand? Add the link if you have it, then mark it posted.
            </p>
            <div className="flex gap-2">
              <input
                value={permalink}
                onChange={(e) => setPermalink(e.target.value)}
                placeholder="Link (optional) — https://www.instagram.com/…"
                className={field}
              />
              <button
                onClick={markPosted}
                disabled={pending}
                className="shrink-0 rounded-lg bg-ok px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                <span className="flex items-center gap-1">
                  <IconCheck size={12} /> Mark as posted
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-5 gap-1.5">
            {(["views", "likes", "comments", "shares", "saves"] as const).map((k) => (
              <label key={k} className="block">
                <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-ink-3">{k}</span>
                <input
                  value={m[k]}
                  onChange={(e) => setM((prev) => ({ ...prev, [k]: e.target.value }))}
                  inputMode="numeric"
                  placeholder="—"
                  className={field}
                />
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={permalink}
              onChange={(e) => setPermalink(e.target.value)}
              placeholder="Link to the post — https://www.instagram.com/…"
              className={field}
            />
            <button
              onClick={saveLink}
              disabled={pending}
              className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
            >
              Save link
            </button>
          </div>
          {trial.onMainFeed ? (
            <p className="text-[11px] leading-relaxed text-ink-3">
              Live on the main feed. Its numbers come from Instagram automatically once the link is saved
              (or when the dashboard posted it) — you only type numbers in for trial reels.
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            {trial.permalink ? (
              <a
                href={trial.permalink}
                target="_blank"
                rel="noreferrer"
                className="truncate text-[11px] text-accent hover:underline"
              >
                Open the post ↗
              </a>
            ) : (
              <span />
            )}
            <span className="flex items-center gap-2">
              <button
                onClick={undoPosted}
                disabled={pending}
                className="text-[11px] text-ink-3 underline hover:text-ink-2 disabled:opacity-50"
              >
                Not posted yet — move back
              </button>
              <button
                onClick={saveMetrics}
                disabled={pending}
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
              >
                Save numbers
              </button>
            </span>
          </div>
        </div>
      )}
      </>
      ) : null}
    </div>
  );
}

function JobRow({ job: j }: { job: PostingJobItem }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
      <span
        className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
          j.status === "failed"
            ? "bg-red-500/15 text-red-400"
            : j.status === "publishing"
              ? "bg-sky-500/15 text-sky-400"
              : "bg-raised text-ink-3"
        }`}
      >
        {j.status}
      </span>
      <p className="min-w-0 flex-1 truncate text-sm">{j.videoTitle}</p>
      <span className="text-[11px] text-ink-3">
        {j.scheduled_for
          ? new Date(j.scheduled_for).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
          : "unscheduled"}
      </span>
      {j.error ? <span className="basis-full text-[11px] text-red-400">{j.error}</span> : null}
      {j.status === "scheduled" ? (
        <button
          onClick={() =>
            startTransition(async () => {
              const res = await vaCancelScheduledAction(j.id);
              if (res?.error) toast.error(res.error);
              else {
                toast.success("Taken off the schedule — it's back in To post.");
                router.refresh();
              }
            })
          }
          disabled={pending}
          className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-red-400 hover:text-red-400 disabled:opacity-50"
        >
          Cancel
        </button>
      ) : null}
    </div>
  );
}

interface VideoGroup {
  videoId: string;
  title: string;
  coverUrl: string | null;
  trials: PostingTrialItem[];
}

function groupByVideo(trials: PostingTrialItem[]): VideoGroup[] {
  const map = new Map<string, VideoGroup>();
  for (const t of trials) {
    const g = map.get(t.videoId) ?? { videoId: t.videoId, title: t.videoTitle, coverUrl: null, trials: [] };
    g.coverUrl ??= t.coverUrl;
    g.trials.push(t);
    map.set(t.videoId, g);
  }
  return [...map.values()];
}

/** The small card on the board: enough to know what it is and what's left, nothing more. */
function VideoCard({ group, onOpen }: { group: VideoGroup; onOpen: () => void }) {
  const toPost = group.trials.filter((t) => t.status === "planned").length;
  const main = group.trials.filter((t) => (t.status === "planned" ? t.postAs === "main" : t.onMainFeed)).length;
  const trial = group.trials.length - main;
  const awaiting = group.trials.filter((t) => t.status !== "planned" && !t.onMainFeed && !t.hasMetrics).length;
  const next = group.trials
    .filter((t) => t.status === "planned" && t.scheduled_for)
    .map((t) => t.scheduled_for as string)
    .sort()[0];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-xl border border-line bg-card p-3 text-left transition hover:border-accent"
    >
      {group.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={group.coverUrl} alt="" className="h-14 w-14 shrink-0 rounded-md object-cover" />
      ) : (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-raised text-lg text-ink-3">▶</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{group.title}</span>
        <span className="mt-0.5 block truncate text-[11px] text-ink-3">
          {group.trials.length} variant{group.trials.length === 1 ? "" : "s"}
          {trial ? ` · ${trial} trial` : ""}
          {main ? ` · ${main} main feed` : ""}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {toPost > 0 ? (
            <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
              {toPost} to post
            </span>
          ) : (
            <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
              ✓ All posted
            </span>
          )}
          {awaiting > 0 ? (
            <span className="rounded-md bg-raised px-1.5 py-0.5 text-[10px] text-ink-3">{awaiting} awaiting numbers</span>
          ) : null}
          {next ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-ink-3">
              <IconClock size={10} />
              {new Date(next).toLocaleDateString([], { day: "numeric", month: "short" })}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

/** Click a card and this opens: every variant of the video, one open at a time. */
function VideoDialog({
  group,
  onClose,
  instagramConnected,
  clientName,
}: {
  group: VideoGroup;
  onClose: () => void;
  instagramConnected: boolean;
  clientName: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();
  const [sendingBack, setSendingBack] = useState(false);
  const [reason, setReason] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const activeId = openId ?? (group.trials.find((t) => t.status === "planned") ?? group.trials[0])?.id ?? "";
  return (
    <div
      role="dialog"
      aria-modal
      aria-label={group.title}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-3 py-6 sm:py-10"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl border border-line bg-app p-4 shadow-2xl sm:p-5"
      >
        <div className="mb-3 flex items-start gap-3">
          {group.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={group.coverUrl} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold">{group.title}</h2>
            <p className="text-[11px] text-ink-3">
              Everything for this video is in here. Set each variant to a trial reel or the main feed — post the
              trials first, then record which one went to the main feed.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-lg leading-none text-ink-3 hover:bg-hover hover:text-ink"
          >
            ×
          </button>
        </div>
        {group.trials.some((t) => t.status === "planned" || t.scheduled) ? (
          <div className="mb-3">
            {sendingBack ? (
              <div className="rounded-xl border border-warn/40 bg-warn/5 p-3">
                <p className="text-xs font-medium text-ink">
                  Send this back to {clientName}&rsquo;s side — it goes to Final Review.
                </p>
                <p className="mt-0.5 text-[11px] text-ink-3">
                  Unposted variants leave your desk (their captions are kept) and anything scheduled is taken off the
                  schedule. Say what needs changing — it goes in the video&rsquo;s chat and they&rsquo;re notified.
                </p>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  autoFocus
                  placeholder="e.g. The cover has a typo, and the caption mentions the wrong date."
                  className="mt-2 w-full resize-y rounded-md border border-line bg-raised px-2 py-1.5 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={pending || !reason.trim()}
                    onClick={() =>
                      startTransition(async () => {
                        const res = await vaSendBackAction(group.videoId, reason);
                        if (res?.error) toast.error(res.error);
                        else {
                          toast.success("Sent back — it's in Final Review now.");
                          onClose();
                          router.refresh();
                        }
                      })
                    }
                    className="rounded-lg bg-warn px-3 py-1.5 text-xs font-medium text-black hover:opacity-90 disabled:opacity-50"
                  >
                    Send it back
                  </button>
                  <button
                    type="button"
                    onClick={() => setSendingBack(false)}
                    className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:text-ink"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSendingBack(true)}
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-warn hover:text-ink"
              >
                Something needs changing — send it back
              </button>
            )}
          </div>
        ) : null}
        <div className="space-y-2">
          {group.trials.map((t) => (
            <VariantPanel
              key={t.id}
              trial={t}
              open={activeId === t.id}
              onToggle={() => setOpenId(activeId === t.id ? "none" : t.id)}
              instagramConnected={instagramConnected}
              clientName={clientName}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function PostingQueue({
  trials,
  jobs,
  viewerRole,
  instagramConnected,
  clientName,
}: {
  trials: PostingTrialItem[];
  jobs: PostingJobItem[];
  viewerRole: Role;
  instagramConnected: boolean;
  clientName: string;
}) {
  const [tab, setTab] = useState<"to_post" | "posted">("to_post");
  const [query, setQuery] = useState("");
  const [openVideo, setOpenVideo] = useState<string | null>(null);

  const groups = groupByVideo(trials);
  const toPost = groups.filter((g) => g.trials.some((t) => t.status === "planned"));
  const posted = groups
    .filter((g) => !g.trials.some((t) => t.status === "planned"))
    .filter((g) => !query.trim() || g.title.toLowerCase().includes(query.trim().toLowerCase()));
  const shown = tab === "to_post" ? toPost : posted;
  const opened = groups.find((g) => g.videoId === openVideo) ?? null;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["to_post", `To post · ${toPost.length}`],
              ["posted", `Posted · ${groups.length - toPost.length}`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                tab === k ? "bg-raised font-medium text-ink" : "text-ink-3 hover:text-ink-2"
              }`}
            >
              {label}
            </button>
          ))}
          {tab === "posted" ? (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search posted videos…"
              className="ml-auto w-56 rounded-md border border-line bg-raised px-2 py-1.5 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
          ) : null}
        </div>
        {tab === "posted" ? (
          <p className="text-[11px] text-ink-3">
            Everything that has gone out. Open one to see where each variant was posted, fix its state, add a link, or bring
            the numbers back.
          </p>
        ) : null}

        {shown.length === 0 ? (
          <p className="rounded-xl border border-line bg-card px-4 py-8 text-center text-sm text-ink-3">
            {tab === "to_post"
              ? `Nothing waiting. A video shows up here once ${clientName} sends it to you.`
              : "Nothing posted yet."}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((g) => (
              <VideoCard key={g.videoId} group={g} onOpen={() => setOpenVideo(g.videoId)} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink-2">Scheduled — these go out by themselves</h2>
        <p className="text-[11px] text-ink-3">
          These publish themselves through the Instagram API — listed so nothing gets posted twice.
          {viewerRole === "va" ? " If one shows Failed, tell the team." : ""}
        </p>
        {jobs.length === 0 ? (
          <p className="rounded-xl border border-line bg-card px-4 py-6 text-center text-sm text-ink-3">
            The automatic queue is empty.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-app">
            {jobs.map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
          </div>
        )}
      </section>

      {opened ? (
        <VideoDialog
          group={opened}
          onClose={() => setOpenVideo(null)}
          instagramConnected={instagramConnected}
          clientName={clientName}
        />
      ) : null}
    </div>
  );
}
