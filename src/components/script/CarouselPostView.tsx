"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { StageBack } from "@/components/pipeline/StageBack";
import { CarouselSlides } from "@/components/script/CarouselSlides";
import { markPostedAction } from "@/app/pipeline-actions";
import { IconCheck, IconChevronRight } from "@/components/ui/icons";
import { STATUS_COLOR, STATUS_LABELS, type CarouselImage, type Video } from "@/lib/types";

/**
 * The carousel's whole life after approval, in one place. There's no cut to
 * review and no editor to hand it to — the slides ARE the deliverable, so
 * this is slides-first: still fully editable in case a caption or image
 * needs a last fix, then one button to mark it posted. Ready to Post is a
 * genuine stop here (not a fly-through, the way it is for a video), because
 * for a carousel it's the only checkpoint before it goes out.
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
  const posted = video.status === "posted";

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

          {posted ? (
            <span className="ml-auto flex items-center gap-1.5 text-xs text-ok">
              <IconCheck size={13} />
              Posted
            </span>
          ) : (
            <span className="ml-auto flex items-center gap-1">
              <StageBack videoId={video.id} status={video.status} carousel />
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await markPostedAction(video.id);
                    if (res?.error) toast.error(res.error);
                    else {
                      toast.success("Marked posted.");
                      router.refresh();
                    }
                  })
                }
                className="flex shrink-0 items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white transition hover:bg-accent-hi disabled:opacity-50"
              >
                Mark posted
                <IconChevronRight size={11} />
              </button>
            </span>
          )}
        </div>
      </div>

      <CarouselSlides
        videoId={video.id}
        slides={carouselSlides}
        carouselStyle={video.carousel_style}
      />
    </div>
  );
}
