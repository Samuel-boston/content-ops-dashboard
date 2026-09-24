"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { StageBack } from "@/components/pipeline/StageBack";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TrialsPanel } from "@/components/workspace/TrialsPanel";
import { CarouselSlides } from "@/components/script/CarouselSlides";
import {
  approveCarouselCreativeAction,
  markPostedAction,
} from "@/app/pipeline-actions";
import { IconCheck, IconChevronRight, IconSparkles } from "@/components/ui/icons";
import { STATUS_COLOR, STATUS_LABELS, type CarouselImage, type Profile, type ScriptComment, type Video } from "@/lib/types";
import { ParkButton } from "@/components/pipeline/ParkButton";
import { ThumbnailPanel } from "@/components/workspace/ThumbnailPanel";

/**
 * The carousel's whole life after the script is approved, in one place.
 * There's no cut to review and no editor to hand it to — the slides ARE the
 * deliverable — so this is slides-first, still fully editable, with the
 * action bar changing by status:
 *
 *   Creatives       — the images are being made; when they are done, one button
 *                     sends it to the VA.
 *   With the VA     — one button, mark it posted.
 *   Posted          — done, read-only.
 */
export function CarouselPostView({
  video,
  carouselSlides,
  chat,
  comments,
  viewer,
}: {
  video: Video;
  carouselSlides: CarouselImage[];
  chat?: React.ReactNode;
  /** Notes on the slides — the same thread the script stage used, carried into creative review. */
  comments?: ScriptComment[];
  viewer?: Pick<Profile, "id" | "role">;
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
          <ParkButton videoId={video.id} parked={Boolean(video.parked_at)} compact />
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

          {video.status === "needs_creatives" ? (
            <span className="ml-auto flex items-center gap-1">
              <StageBack videoId={video.id} status={video.status} carousel />
              <span className="flex items-center gap-1.5 px-1 text-[11px] text-ink-3">
                <IconSparkles size={12} />
                Make the images below, then send it to the VA
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(() => approveCarouselCreativeAction(video.id), "Done — it's on the VA's desk.")
                }
                className="flex shrink-0 items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white transition hover:bg-accent-hi disabled:opacity-50"
              >
                Creatives are done — send to the VA
                <IconChevronRight size={11} />
              </button>
            </span>
          ) : video.status === "with_va" ? (
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

      <ThumbnailPanel videoId={video.id} />

      <CarouselSlides
        videoId={video.id}
        slides={carouselSlides}
        carouselStyle={video.carousel_style}
        comments={comments}
        viewer={viewer}
      />

      {/* Approved: hand it to the VA to post — notes, a cover and a caption. */}
      {video.status === "with_va" || video.status === "posted" ? (
        <div className="max-w-2xl">
          <TrialsPanel
            videoId={video.id}
            vaNotes={video.va_notes}
            status={video.status}
            hasCover={Boolean(video.cover_path)}
          />
        </div>
      ) : null}

      {chat}

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
