"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { StageBack } from "@/components/pipeline/StageBack";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CarouselSlides } from "@/components/script/CarouselSlides";
import {
  approveCarouselCreativeAction,
  markPostedAction,
  requestCarouselRevisionsAction,
  resubmitCarouselCreativeAction,
} from "@/app/pipeline-actions";
import { IconCheck, IconChevronRight, IconSparkles } from "@/components/ui/icons";
import { STATUS_COLOR, STATUS_LABELS, type CarouselImage, type Video } from "@/lib/types";

/**
 * The carousel's whole life after the script is approved, in one place.
 * There's no cut to review and no editor to hand it to — the slides ARE the
 * deliverable — so this is slides-first, still fully editable, with the
 * action bar changing by status:
 *
 *   Creative Review    — the images are made, client checks them: approve
 *                         to Ready to Post, or send back for another pass.
 *   Creative Revisions — sent back; resubmit once the creatives are fixed.
 *   Ready to Post       — one button, mark it posted.
 *   Posted              — done, read-only.
 */
export function CarouselPostView({
  video,
  carouselSlides,
}: {
  video: Video;
  carouselSlides: CarouselImage[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTrackedTransition();
  const [confirmPosted, setConfirmPosted] = useState(false);

  function run(action: () => Promise<{ error?: string } | void>, ok: string) {
    startTransition(async () => {
      const res = await action();
      if (res && "error" in res && res.error) toast.error(res.error);
      else {
        toast.success(ok);
        router.refresh();
      }
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/board" className="text-sm text-ink-3 hover:text-ink">
            Board
          </Link>
          <span className="text-ink-3">/</span>
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{video.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]"
            style={{
              color: STATUS_COLOR[video.status],
              background: `color-mix(in srgb, ${STATUS_COLOR[video.status]} 12%, transparent)`,
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[video.status] }} />
            {STATUS_LABELS[video.status]}
          </span>

          {video.status === "creative_review" ? (
            <span className="ml-auto flex items-center gap-1">
              <StageBack videoId={video.id} status={video.status} carousel />
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(() => requestCarouselRevisionsAction(video.id), "Sent back for changes.")
                }
                className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] text-ink-3 transition hover:bg-hover hover:text-ink disabled:opacity-50"
              >
                Send back — needs changes
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(() => approveCarouselCreativeAction(video.id), "Approved — ready to post.")
                }
                className="flex shrink-0 items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white transition hover:bg-accent-hi disabled:opacity-50"
              >
                Approve — ready to post
                <IconChevronRight size={11} />
              </button>
            </span>
          ) : video.status === "creative_revisions" ? (
            <span className="ml-auto flex items-center gap-1">
              <StageBack videoId={video.id} status={video.status} carousel />
              <span className="flex items-center gap-1.5 px-1 text-[11px] text-ink-3">
                <IconSparkles size={12} />
                Sent back — needs new creatives
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(() => resubmitCarouselCreativeAction(video.id), "Resubmitted for review.")
                }
                className="flex shrink-0 items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-2 transition hover:border-accent hover:text-ink disabled:opacity-50"
              >
                Resubmit — ready for review
                <IconChevronRight size={11} />
              </button>
            </span>
          ) : video.status === "ready_to_post" ? (
            <span className="ml-auto flex items-center gap-1">
              <StageBack videoId={video.id} status={video.status} carousel />
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirmPosted(true)}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white transition hover:bg-accent-hi disabled:opacity-50"
              >
                Mark posted
                <IconChevronRight size={11} />
              </button>
            </span>
          ) : (
            <span className="ml-auto flex items-center gap-1.5 text-xs text-ok">
              <IconCheck size={13} />
              Posted
            </span>
          )}
        </div>
      </div>

      <CarouselSlides
        videoId={video.id}
        slides={carouselSlides}
        carouselStyle={video.carousel_style}
      />

      <ConfirmDialog
        open={confirmPosted}
        title="Mark as posted?"
        body="Marking as posted will move this off the dashboard and into the Google Drive archive."
        confirmLabel="Proceed"
        cancelLabel="Go back"
        onCancel={() => setConfirmPosted(false)}
        onConfirm={() => {
          setConfirmPosted(false);
          run(() => markPostedAction(video.id), "Marked posted.");
        }}
      />
    </div>
  );
}
