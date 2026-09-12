"use client";

import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { ClaimDialog } from "@/components/pipeline/Eta";
import { assignEditorAction } from "@/app/actions";
import { IconCheck } from "@/components/ui/icons";

/**
 * "Take this one" — the only assignment control an editor ever sees.
 *
 * It used to be a dropdown listing every editor. The server and a database
 * trigger both refuse an editor assigning work to somebody else, so nothing
 * could actually go wrong — but a menu full of your colleagues' names is still
 * an invitation to misclick, and being told "you can't do that" after picking
 * the wrong name is a bad moment. A button that can only mean one thing
 * removes the question entirely.
 *
 * Handing work *out* is the client's job, and that control lives on their
 * board where it belongs.
 */
export function ClaimButton({
  videoId,
  videoTitle,
  mine,
  currentEta,
}: {
  videoId: string;
  videoTitle: string;
  /** Already assigned to the viewer — offer to hand it back instead. */
  mine: boolean;
  currentEta?: string | null;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();
  const [claiming, setClaiming] = useState(false);
  const [confirmDrop, setConfirmDrop] = useState(false);

  if (mine) {
    return confirmDrop ? (
      <span className="flex shrink-0 items-center gap-1.5">
        <span className="text-[11px] text-ink-3">Put it back?</span>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await assignEditorAction(videoId, null);
              if (res?.error) toast.error(res.error);
              else {
                toast.success("Back in the bay.");
                router.refresh();
              }
            })
          }
          className="rounded-lg bg-danger px-2.5 py-1.5 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => setConfirmDrop(false)}
          className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-3 hover:text-ink"
        >
          No
        </button>
      </span>
    ) : (
      <button
        type="button"
        onClick={() => setConfirmDrop(true)}
        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-ok/10 px-2.5 py-1.5 text-[11px] text-ok transition hover:bg-ok/20"
      >
        <IconCheck size={11} />
        Yours
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => setClaiming(true)}
        className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-accent-hi disabled:opacity-50"
      >
        Take this one
      </button>
      <ClaimDialog
        open={claiming}
        videoId={videoId}
        title={videoTitle}
        mode="claim"
        currentEta={currentEta ?? null}
        onClose={() => setClaiming(false)}
      />
    </>
  );
}
