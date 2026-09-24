"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TrialsPanel } from "@/components/workspace/TrialsPanel";
import { getVaHandoffInfoAction } from "@/app/trial-actions";

/**
 * Opens when a card is dragged from Ready to Post to With the VA. The move is
 * the hand-off, so it isn't done until each variant's destination (trial reel or
 * main feed) and caption have been seen — this is the same panel as the video's
 * Post tab, with the same "Send to the VA" button. Closing it leaves the card
 * where it was.
 */
export function SendToVaDialog({ videoId, onClose }: { videoId: string; onClose: () => void }) {
  const router = useRouter();
  const [info, setInfo] = useState<Awaited<ReturnType<typeof getVaHandoffInfoAction>> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getVaHandoffInfoAction(videoId).then((r) => !cancelled && setInfo(r));
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Send to the VA"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-3 py-6 sm:py-10"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl border border-line bg-app p-4 shadow-2xl sm:p-5"
      >
        <div className="mb-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold">Send “{info?.title ?? "…"}” to the VA</h2>
            <p className="text-[11px] text-ink-3">
              Check each variant before it goes: trial reel or main feed, and its caption. Nothing moves until you press
              Send to the VA.
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
        {info === undefined ? (
          <p className="px-1 py-6 text-center text-xs text-ink-3">Loading…</p>
        ) : info === null ? (
          <p className="px-1 py-6 text-center text-xs text-ink-3">Couldn&rsquo;t open that video.</p>
        ) : (
          <TrialsPanel
            videoId={videoId}
            status="ready_to_post"
            vaNotes={info.notes}
            hasCover={info.hasCover}
            fallbackCaption={info.postCaption}
            initial={{ trials: info.trials, cuts: info.cuts }}
            onSent={() => {
              onClose();
              router.refresh();
            }}
          />
        )}
      </div>
    </div>
  );
}
