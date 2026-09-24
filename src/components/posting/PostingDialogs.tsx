"use client";
import type { PublishChannel } from "@/lib/types";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  getPostingVideoAction,
  vaMarkVideoPostedAction,
  vaSendBackAction,
  type PostingFeedMetrics,
  type PostingJobItem,
  type PostingTrialItem,
} from "@/app/posting-actions";
import { VariantDetail } from "@/components/posting/VariantDetail";
import { VariantWorkRow } from "@/components/posting/VariantWorkRow";
import { STATE_LABELS, STATE_TONE, isToPost } from "@/lib/variant-state";

interface Loaded {
  trials: PostingTrialItem[];
  jobs: PostingJobItem[];
  feedMetrics: Record<string, PostingFeedMetrics>;
  instagramConnected: boolean;
  publerConnected?: boolean;
  channels?: PublishChannel[];
}

function Shell({ title, subtitle, cover, onClose, children }: { title: string; subtitle: string; cover?: string | null; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal
      aria-label={title}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-3 py-6 sm:py-10"
    >
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl rounded-2xl border border-line bg-app p-4 shadow-2xl sm:p-5">
        <div className="mb-3 flex items-start gap-3">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
          ) : null}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">{title}</h1>
            <p className="text-[11px] text-ink-3">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-lg leading-none text-ink-3 hover:bg-hover hover:text-ink">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A video that is with the VA: every variant, small, on one page — then Mark as posted. */
export function VideoWorkDialog({
  trials,
  jobs,
  instagramConnected,
  publerConnected = false,
  channels,
  clientName,
  onClose,
}: {
  trials: PostingTrialItem[];
  jobs: PostingJobItem[];
  instagramConnected: boolean;
  publerConnected?: boolean;
  channels?: PublishChannel[];
  clientName: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();
  const [confirmPosted, setConfirmPosted] = useState(false);
  // "Keep working" is remembered against the current set of statuses, so the prompt
  // comes back the next time something changes — but not on every re-render.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [sendingBack, setSendingBack] = useState(false);
  const [reason, setReason] = useState("");
  const first = trials[0];
  const videoId = first.videoId;
  const left = trials.filter((t) => isToPost(t.state)).length;
  const scheduledLeft = trials.filter((t) => t.state === "scheduled_feed").length;
  const statusKey = trials.map((t) => `${t.id}:${t.state}`).join("|");
  const allPosted = left === 0;
  // The moment the last variant is marked posted, ask whether to close the video out.
  const confirmOpen = confirmPosted || (allPosted && dismissedFor !== statusKey);
  const failed = jobs.filter((j) => j.videoId === videoId && j.status === "failed");

  return (
    <Shell
      title={first.videoTitle}
      subtitle={`${trials.length} hook variant${trials.length === 1 ? "" : "s"} — post each one, then mark the video posted.`}
      cover={trials.find((t) => t.coverUrl)?.coverUrl}
      onClose={onClose}
    >
      <div className="space-y-3">
        {first.notes ? (
          <p className="whitespace-pre-wrap rounded-lg border border-line bg-card px-3 py-2 text-xs leading-relaxed text-ink-2">
            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-ink-3">Instructions</span>
            {first.notes}
          </p>
        ) : null}
        {failed.map((j) => (
          <p key={j.id} className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            ⚠ A post failed{j.error ? `: ${j.error}` : "."}
          </p>
        ))}

        {trials.map((t) => (
          <VariantWorkRow key={t.id} trial={t} instagramConnected={instagramConnected} publerConnected={publerConnected} channels={channels} clientName={clientName} />
        ))}

        {sendingBack ? (
          <div className="rounded-xl border border-warn/40 bg-warn/5 p-3">
            <p className="text-xs font-medium text-ink">Send this back to {clientName}&rsquo;s side — it goes back to review.</p>
            <p className="mt-0.5 text-[11px] text-ink-3">
              It leaves this board (captions are kept) and anything scheduled is taken off the schedule. Say what&rsquo;s not right — it goes
              in the video&rsquo;s chat and they&rsquo;re notified.
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
                    const res = await vaSendBackAction(videoId, reason);
                    if (res?.error) toast.error(res.error);
                    else {
                      toast.success("Sent back — it's back in review on their board.");
                      onClose();
                      router.refresh();
                    }
                  })
                }
                className="rounded-lg bg-warn px-3 py-1.5 text-xs font-medium text-black hover:opacity-90 disabled:opacity-50"
              >
                Send it back
              </button>
              <button type="button" onClick={() => setSendingBack(false)} className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:text-ink">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <button
              type="button"
              onClick={() => setSendingBack(true)}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-warn hover:text-ink"
            >
              Something not quite right?
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirmPosted(true)}
              className="ml-auto rounded-lg bg-ok px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              ✓ Mark as posted
            </button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={allPosted ? "Everything's posted" : "Mark as posted?"}
        body={
          allPosted
            ? `Every variant in this video is marked as posted${
                scheduledLeft ? ` (${scheduledLeft} scheduled for the feed will still go out by itself)` : ""
              }. Confirming moves it into the archive, where you can add trial numbers and post the best one to the feed. Are you sure?`
            : `${left} variant${left === 1 ? " is" : "s are"} still marked to post — they'll be counted as posted. Marking as posted moves this into the archive, where you can add trial numbers and post the best one to the feed. Are you sure?`
        }
        confirmLabel="Confirm"
        cancelLabel="Keep working"
        onCancel={() => {
          setConfirmPosted(false);
          setDismissedFor(statusKey);
        }}
        onConfirm={() => {
          setConfirmPosted(false);
          setDismissedFor(statusKey);
          startTransition(async () => {
            const res = await vaMarkVideoPostedAction(videoId);
            if (res?.error) toast.error(res.error);
            else {
              toast.success("Posted — it's in the Archive tab.");
              onClose();
              router.refresh();
            }
          });
        }}
      />
    </Shell>
  );
}

/**
 * A posted video, in the archive: how each variant did, which trial is winning,
 * and the button to post the best one to the main feed (now or scheduled).
 * Loads the whole video itself, so it works from the board, the archive list,
 * and the client's own archive.
 */
export function PostedVideoPanel({ videoId, clientName }: { videoId: string; clientName: string }) {
  const [data, setData] = useState<Loaded | undefined>(undefined);
  const [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(() => {
    getPostingVideoAction(videoId).then(setData);
  }, [videoId]);
  useEffect(() => {
    let cancelled = false;
    getPostingVideoAction(videoId).then((r) => !cancelled && setData(r));
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  if (data === undefined) return <p className="py-8 text-center text-xs text-ink-3">Loading…</p>;
  const { trials, feedMetrics, instagramConnected } = data;
  if (!trials.length) return <p className="py-8 text-center text-xs text-ink-3">This video has no variants on record.</p>;

  const ranked = trials
    .filter((t) => t.state === "trial_posted" && t.views !== null)
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  const leader = ranked[0];
  const noFeedYet = !trials.some((t) => t.state === "feed_posted" || t.state === "scheduled_feed");

  return (
    <div className="space-y-3">
      {leader && noFeedYet ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
          <p className="min-w-0 flex-1 text-sm">
            🏆 <b>{leader.label}</b> is leading — {leader.views?.toLocaleString()} views
            {ranked[1] ? ` (next: ${ranked[1].label}, ${ranked[1].views?.toLocaleString()})` : ""}.
          </p>
          <button
            type="button"
            onClick={() => setOpenId(leader.id)}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hi"
          >
            Post it to the main feed →
          </button>
        </div>
      ) : !ranked.length && trials.some((t) => t.state === "trial_posted") ? (
        <p className="rounded-lg border border-line bg-card px-3 py-2 text-xs text-ink-3">
          Add each trial reel&rsquo;s numbers below (from Instagram&rsquo;s insights screen) and this will show which one is winning.
        </p>
      ) : null}

      {ranked.length > 1 ? (
        <div className="rounded-lg border border-line bg-card px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">How the trials are doing</p>
          <ol className="mt-1 space-y-0.5">
            {ranked.map((t, i) => (
              <li key={t.id} className="flex items-center gap-2 text-xs">
                <span className="w-4 text-ink-3">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate">{i === 0 ? "🏆 " : ""}{t.label}</span>
                <span className="tabular-nums text-ink-2">{t.views?.toLocaleString()} views</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {trials.map((t) => {
        const open = openId === t.id;
        return (
          <div key={t.id} className={`rounded-xl border ${open ? "border-accent/50" : "border-line"} bg-app p-3`}>
            <button type="button" onClick={() => setOpenId(open ? null : t.id)} aria-expanded={open} className="flex w-full items-center gap-2 text-left">
              <span className="text-ink-3">{open ? "▾" : "▸"}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.winner ? "🏆 " : ""}{t.label}</span>
              {t.views !== null ? <span className="text-[11px] tabular-nums text-ink-3">{t.views.toLocaleString()} views</span> : null}
              <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATE_TONE[t.state]}`}>{STATE_LABELS[t.state]}</span>
            </button>
            {open ? (
              <div className="mt-3">
                <VariantDetail
                  trial={t}
                  feedMetrics={feedMetrics[t.videoId] ?? null}
                  instagramConnected={instagramConnected}
                  clientName={clientName}
                  onChanged={load}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** The posted-video panel in its own dialog — for the board's Posted column, the archive list, and the client's archive. */
export function PostedVideoDialog({ videoId, title, clientName, onClose }: { videoId: string; title: string; clientName: string; onClose: () => void }) {
  return (
    <Shell title={title} subtitle="Posted — performance, and the button to post the best trial to the main feed." onClose={onClose}>
      <PostedVideoPanel videoId={videoId} clientName={clientName} />
    </Shell>
  );
}
