"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getVideoQuickView } from "@/app/board-actions";
import { BriefTab } from "@/components/workspace/BriefTab";
import { VideoFootage } from "@/components/VideoFootage";
import { IconChevronRight, IconX } from "@/components/ui/icons";
import { STATUS_COLOR, STATUS_LABELS, type Series, type Video, type VideoAsset } from "@/lib/types";

/**
 * The board's quick-edit drawer — fill in a video's basics without leaving
 * the board behind. Opens automatically right after creating a video (so
 * "New video" actually lands you looking at the thing you just made, not a
 * blank board with a card added somewhere in it) and from clicking any card,
 * an alternative to the full `/videos/[id]` page for a video that doesn't
 * have a cut, comments or a script yet to make that page worth a full nav.
 */
export function VideoQuickView({
  videoId,
  customs,
  seriesOptions,
  onClose,
}: {
  videoId: string;
  customs: { content_pillar: string[]; format: string[]; platform: string[] };
  seriesOptions: Series[];
  onClose: () => void;
}) {
  const [data, setData] = useState<{ video: Video; assets: VideoAsset[]; driveConfigured: boolean } | null>(
    null
  );
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getVideoQuickView(videoId).then((res) => {
      if (cancelled) return;
      if (!res) setNotFound(true);
      else setData(res);
    });
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-line bg-card shadow-2xl">
        {notFound ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-sm text-ink-2">This video isn&rsquo;t there anymore.</p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:bg-hover"
            >
              Close
            </button>
          </div>
        ) : !data ? (
          <div className="flex flex-1 items-center justify-center">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
              <span
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] shrink-0"
                style={{
                  color: STATUS_COLOR[data.video.status],
                  background: `color-mix(in srgb, ${STATUS_COLOR[data.video.status]} 12%, transparent)`,
                }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: STATUS_COLOR[data.video.status] }}
                />
                {STATUS_LABELS[data.video.status]}
              </span>
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{data.video.title}</h2>
              <Link
                href={`/videos/${data.video.id}`}
                className="flex shrink-0 items-center gap-1 text-xs text-ink-3 hover:text-ink"
              >
                Full page
                <IconChevronRight size={11} />
              </Link>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-ink"
              >
                <IconX size={16} />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              <BriefTab video={data.video} customs={customs} canEdit seriesOptions={seriesOptions} />
              <section className="rounded-xl border border-line bg-app p-4">
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                  Raw footage
                </h2>
                <VideoFootage
                  videoId={data.video.id}
                  assets={data.assets}
                  driveConfigured={data.driveConfigured}
                />
              </section>
            </div>
          </>
        )}
      </div>
    </>
  );
}
