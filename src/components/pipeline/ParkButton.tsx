"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { parkVideoAction, unparkVideoAction } from "@/app/pipeline-actions";
import { IconClock, IconPlay } from "@/components/ui/icons";
import { DeleteVideoButton } from "@/components/pipeline/DeleteVideoButton";

/**
 * Shelve a video, or take it back off the shelf.
 *
 * The reason is optional but prompted for, because "why isn't this happening"
 * is the question you'll actually have when you come back to the shelf in two
 * months — and by then nobody remembers.
 */
export function ParkButton({
  videoId,
  parked,
  compact = false,
}: {
  videoId: string;
  parked: boolean;
  compact?: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (parked) {
    return (
      <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await unparkVideoAction(videoId);
            if (res?.error) toast.error(res.error);
            else {
              toast.success("Back in the pipeline.");
              router.refresh();
            }
          })
        }
        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white transition hover:bg-accent-hi disabled:opacity-50"
      >
        <IconPlay size={11} />
        Pick back up
      </button>
      <DeleteVideoButton videoId={videoId} compact={compact} />
      </span>
    );
  }

  if (!open) {
    return (
      <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Shelve this for later"
        className={`flex shrink-0 items-center gap-1 rounded-lg border border-line text-ink-3 transition hover:border-warn hover:text-warn ${
          compact ? "px-1.5 py-1 text-[10px]" : "px-2.5 py-1.5 text-[11px]"
        }`}
      >
        <IconClock size={compact ? 10 : 11} />
        Later
      </button>
      <DeleteVideoButton videoId={videoId} compact={compact} />
      </span>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-xl border border-warn/40 bg-warn/5 p-3">
      <p className="text-[11px] leading-snug text-ink-2">
        This comes off the board and out of every count until you pick it back up. It keeps its
        stage, so nothing you&rsquo;ve written is lost.
      </p>
      <input
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter") {
            startTransition(async () => {
              const res = await parkVideoAction(videoId, reason);
              if (res?.error) toast.error(res.error);
              else {
                setOpen(false);
                toast.success("Shelved for later.");
                router.refresh();
              }
            });
          }
        }}
        placeholder="Why not now? (optional)"
        className="w-full rounded-lg border border-line bg-raised px-2.5 py-1.5 text-xs placeholder:text-ink-3 focus:border-accent focus:outline-none"
      />
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await parkVideoAction(videoId, reason);
              if (res?.error) toast.error(res.error);
              else {
                setOpen(false);
                toast.success("Shelved for later.");
                router.refresh();
              }
            })
          }
          className="rounded-lg bg-warn px-3 py-1.5 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Shelving…" : "Shelve it"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-line px-3 py-1.5 text-[11px] text-ink-3 hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
