"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import {
  trialPostingKitAction,
  vaCancelScheduledAction,
  vaPublishAction,
  vaSaveLinkAction,
  vaSetVariantStateAction,
  variantPhoneTokenAction,
  type PostingTrialItem,
} from "@/app/posting-actions";
import { IconClock } from "@/components/ui/icons";
import { QR } from "@/components/ui/QR";
import { PostComposer, type ComposerSubmit } from "@/components/posting/PostComposer";
import type { VariantState } from "@/lib/variant-state";

const btn = "rounded-md border border-line px-2.5 py-1 text-[11px] text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50";

/**
 * One hook variant while the VA is working through a video: everything they need,
 * small, in one row — where it goes (trial reel or main feed), whether it's
 * posted, the caption to copy, the cover, the file, and (for the feed) posting
 * through Instagram. Nothing to click into.
 */
export function VariantWorkRow({
  trial,
  instagramConnected,
  clientName,
}: {
  trial: PostingTrialItem;
  instagramConnected: boolean;
  clientName: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();
  const [phoneUrl, setPhoneUrl] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [draftCaption, setDraftCaption] = useState(trial.caption ?? "");
  const [link, setLink] = useState(trial.permalink ?? "");

  const scheduled = trial.state === "scheduled_feed";
  const posted = trial.state === "trial_posted" || trial.state === "feed_posted";
  const dest = trial.postAs;
  const isCarousel = Boolean(trial.images?.length);

  function apply(nextDest: "trial" | "main", nextPosted: boolean) {
    const state: Exclude<VariantState, "scheduled_feed"> = nextPosted
      ? nextDest === "trial" ? "trial_posted" : "feed_posted"
      : nextDest === "trial" ? "to_trial" : "to_feed";
    startTransition(async () => {
      const res = await vaSetVariantStateAction(trial.id, state, link || undefined);
      if (res?.error) toast.error(res.error);
      else router.refresh();
    });
  }

  function download() {
    if (trial.images?.length) {
      trial.images.forEach((u, i) => setTimeout(() => window.open(u, "_blank", "noopener"), i * 250));
      return;
    }
    startTransition(async () => {
      const res = await trialPostingKitAction(trial.id);
      if ("error" in res) return toast.error(res.error);
      if (!res.downloadUrl) return toast.error("No downloadable file for this cut yet — ask the team.");
      if (!res.original) toast.info("Heads up: this is Cloudflare's re-encoded copy, smaller than the original upload.");
      window.open(res.downloadUrl, "_blank", "noopener");
    });
  }

  function copyCaption() {
    if (!trial.caption) return toast.error("No caption written for this one.");
    navigator.clipboard
      .writeText(trial.caption)
      .then(() => toast.success("Caption copied."))
      .catch(() => toast.error("Couldn't copy — select it by hand."));
  }

  function publish(v: ComposerSubmit) {
    startTransition(async () => {
      const res = await vaPublishAction(trial.id, {
        whenISO: v.whenISO,
        caption: v.caption,
        coverOffsetMs: v.coverOffsetMs,
        shareToFeed: v.shareToFeed,
      });
      if (res?.error) return toast.error(res.error);
      toast.success(res.scheduled ? "Scheduled for the feed — it'll go out by itself." : "Posted to the feed on Instagram ✓");
      router.refresh();
    });
  }

  return (
    <div className={`rounded-xl border p-3 ${posted ? "border-emerald-500/30 bg-emerald-500/5" : "border-line bg-card"}`}>
      {/* Where it goes, and whether it's done */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">
          {trial.winner ? "🏆 " : ""}
          {trial.label}
        </p>
        {scheduled ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/15 px-2 py-1 text-[11px] text-sky-300">
            <IconClock size={11} />
            Scheduled for feed{trial.jobAt ? ` · ${new Date(trial.jobAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : ""}
            {trial.jobId ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await vaCancelScheduledAction(trial.jobId as string);
                    if (res?.error) toast.error(res.error);
                    else router.refresh();
                  })
                }
                className="ml-1 underline hover:text-white"
              >
                cancel
              </button>
            ) : null}
          </span>
        ) : (
          <>
            <div className="flex overflow-hidden rounded-md border border-line text-[11px]" role="group" aria-label="Where it goes">
              {(["trial", "main"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={pending}
                  onClick={() => d !== dest && apply(d, posted)}
                  className={`px-2.5 py-1 ${dest === d ? "bg-accent text-white" : "text-ink-3 hover:text-ink"}`}
                >
                  {d === "trial" ? "Trial reel" : "Main feed"}
                </button>
              ))}
            </div>
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-2">
              <input
                type="checkbox"
                checked={posted}
                disabled={pending}
                onChange={(e) => apply(dest, e.target.checked)}
                className="h-3.5 w-3.5 accent-emerald-500"
              />
              Posted
            </label>
          </>
        )}
      </div>

      {/* The material */}
      <div className="mt-2 flex gap-3">
        {trial.coverUrl ? (
          <a href={trial.coverUrl} target="_blank" rel="noreferrer" title="Cover — open to save" className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={trial.coverUrl} alt="Cover" className="h-16 w-16 rounded-md object-cover" />
          </a>
        ) : null}
        <div className="min-w-0 flex-1 space-y-1.5">
          {trial.caption ? (
            <p className="line-clamp-3 whitespace-pre-wrap rounded-md bg-raised px-2 py-1.5 text-xs leading-relaxed text-ink-2">{trial.caption}</p>
          ) : (
            <p className="text-xs text-ink-3">No caption written for this one.</p>
          )}
          {trial.variantNotes ? (
            <p className="whitespace-pre-wrap rounded-md border border-accent/30 bg-accent-ghost/40 px-2 py-1 text-[11px] leading-relaxed text-ink-2">
              <b className="text-ink-3">Note: </b>
              {trial.variantNotes}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button onClick={download} disabled={pending} className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent-hi disabled:opacity-50">
          {isCarousel ? `Images (${trial.images?.length})` : "Download"}
        </button>
        <button
          onClick={() =>
            startTransition(async () => {
              const { token } = await variantPhoneTokenAction(trial.id);
              setPhoneUrl(`${window.location.origin}/api/variant/${token}`);
            })
          }
          disabled={pending}
          className={btn}
        >
          QR to phone
        </button>
        <button onClick={copyCaption} disabled={pending} className={btn}>
          Copy caption
        </button>
        {dest === "main" && !posted && !scheduled ? (
          <button onClick={() => setComposing((v) => !v)} className={`${btn} border-accent/40 text-accent-hi`}>
            {composing ? "Close Instagram form" : "Post via Instagram…"}
          </button>
        ) : null}
      </div>

      {phoneUrl ? (
        <div className="mt-2 flex items-center gap-3 rounded-lg border border-line bg-raised p-2.5">
          <QR url={phoneUrl} size={120} />
          <div className="min-w-0 text-[11px] leading-relaxed text-ink-3">
            <p className="text-ink-2">Scan with your phone — it opens the download and the caption to paste.</p>
            <button type="button" onClick={() => setPhoneUrl(null)} className="mt-1 underline hover:text-ink-2">
              Hide
            </button>
          </div>
        </div>
      ) : null}

      {composing ? (
        <div className="mt-3 rounded-xl border border-accent/30 bg-accent-ghost/40 p-2.5">
          <PostComposer
            caption={draftCaption}
            onCaptionChange={setDraftCaption}
            connected={instagramConnected ? ["instagram"] : []}
            emptyHint={
              <>
                {clientName} connects channels once in Settings → Integrations — after that they show up here to post and
                schedule from. Until then, post it by hand and tick Posted.
              </>
            }
            isVideo={!isCarousel}
            durationSeconds={trial.durationSeconds}
            pending={pending}
            onSubmit={publish}
          />
        </div>
      ) : null}

      {/* The link is optional — only worth keeping when there's a post to point at. */}
      {posted ? (
        <div className="mt-2 flex gap-2">
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onBlur={() => {
              if (link.trim() !== (trial.permalink ?? "").trim()) {
                startTransition(async () => {
                  const res = await vaSaveLinkAction(trial.id, link);
                  if (res?.error) toast.error(res.error);
                  else router.refresh();
                });
              }
            }}
            placeholder="Link to the post (optional)"
            className="w-full rounded-md border border-line bg-raised px-2 py-1 text-xs placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
        </div>
      ) : null}
    </div>
  );
}
