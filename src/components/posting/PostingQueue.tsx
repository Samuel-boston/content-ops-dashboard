"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import {
  trialPostingKitAction,
  vaMarkTrialPostedAction,
  vaSaveTrialMetricsAction,
  type PostingJobItem,
  type PostingTrialItem,
} from "@/app/posting-actions";
import { IconCheck, IconClock } from "@/components/ui/icons";
import type { Role } from "@/lib/types";

/**
 * One trial = one card with everything needed to post it and nothing else:
 * get the file, copy the caption, post from the IG app as a trial, paste the
 * permalink back. Once live, the card flips to a numbers form — the trial's
 * insights only exist inside the IG app, so someone has to carry them over.
 */
function TrialCard({ trial }: { trial: PostingTrialItem }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();
  const [permalink, setPermalink] = useState("");
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
    startTransition(async () => {
      const res = await trialPostingKitAction(trial.id);
      if ("error" in res) return toast.error(res.error);
      if (res.downloadUrl) {
        window.open(res.downloadUrl, "_blank", "noopener");
      } else {
        toast.error("No downloadable file for this cut yet — ask the team.");
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
        toast.success("Marked live. Come back for the numbers once IG shows them.");
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

  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            trial.status === "planned"
              ? due
                ? "bg-red-500/15 text-red-400"
                : "bg-amber-500/15 text-amber-400"
              : "bg-emerald-500/15 text-emerald-400"
          }`}
        >
          {trial.status === "planned" ? (due ? "Overdue" : "To post") : "Live trial"}
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{trial.videoTitle}</p>
        {trial.winner ? <span title="Winning hook">🏆</span> : null}
      </div>
      <p className="mt-1 text-xs text-ink-2">
        Hook: <span className="text-ink">{trial.label}</span>
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
              Get the file
            </button>
            <button
              onClick={copyCaption}
              disabled={pending}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
            >
              Copy caption
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-ink-3">
            Post it from the Instagram app as a <b>trial reel</b> (Share to: Trial), then paste the
            link here.
          </p>
          <div className="flex gap-2">
            <input
              value={permalink}
              onChange={(e) => setPermalink(e.target.value)}
              placeholder="https://www.instagram.com/reel/…"
              className={field}
            />
            <button
              onClick={markPosted}
              disabled={pending || !permalink.trim()}
              className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
            >
              <span className="flex items-center gap-1">
                <IconCheck size={12} /> Posted
              </span>
            </button>
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
          <div className="flex items-center justify-between gap-2">
            {trial.permalink ? (
              <a
                href={trial.permalink}
                target="_blank"
                rel="noreferrer"
                className="truncate text-[11px] text-accent hover:underline"
              >
                Open the trial ↗
              </a>
            ) : (
              <span />
            )}
            <button
              onClick={saveMetrics}
              disabled={pending}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
            >
              Save numbers
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PostingQueue({
  trials,
  jobs,
  viewerRole,
}: {
  trials: PostingTrialItem[];
  jobs: PostingJobItem[];
  viewerRole: Role;
}) {
  const toPost = trials.filter((t) => t.status === "planned");
  const live = trials.filter((t) => t.status === "posted");

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink-2">Trial reels to post</h2>
        {toPost.length === 0 ? (
          <p className="rounded-xl border border-line bg-card px-4 py-8 text-center text-sm text-ink-3">
            Nothing waiting. New trials appear here the moment the team queues them.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {toPost.map((t) => (
              <TrialCard key={t.id} trial={t} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink-2">Live trials — bring the numbers back</h2>
        {live.length === 0 ? (
          <p className="rounded-xl border border-line bg-card px-4 py-8 text-center text-sm text-ink-3">
            No live trials right now.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {live.map((t) => (
              <TrialCard key={t.id} trial={t} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink-2">Automatic queue (no action needed)</h2>
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
              <div key={j.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
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
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
