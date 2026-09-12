"use client";

import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { returnToBayAction } from "@/app/pipeline-actions";
import { IconLayers } from "@/components/ui/icons";

/**
 * Hand a video back to the Editing Bay.
 *
 * Two-step on purpose: this un-assigns the work and drops the promised date,
 * which is a real consequence for whoever was expecting it. The optional
 * reason isn't paperwork — it's what turns "this came back" into something
 * the client can act on without having to ask why.
 */
export function ReturnToBay({
  videoId,
  /** "mine" softens the copy for the editor giving up their own work. */
  mine,
  compact = false,
}: {
  videoId: string;
  mine: boolean;
  compact?: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  function submit() {
    startTransition(async () => {
      const res = await returnToBayAction(videoId, reason);
      if (res?.error) toast.error(res.error);
      else {
        setOpen(false);
        setReason("");
        toast.success("Back in the Editing Bay.");
        router.refresh();
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex shrink-0 items-center gap-1.5 rounded-lg border border-line text-ink-3 transition hover:border-warn hover:text-warn ${
          compact ? "px-2 py-1 text-[10px]" : "px-2.5 py-1.5 text-[11px]"
        }`}
      >
        <IconLayers size={compact ? 10 : 12} />
        {mine ? "Hand back" : "Return to bay"}
      </button>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-xl border border-warn/40 bg-warn/5 p-3">
      <p className="text-[11px] leading-snug text-ink-2">
        {mine
          ? "This goes back into the open pool and your delivery date is cleared. Anyone can pick it up, including you."
          : "This un-assigns the editor and clears their delivery date. It goes back into the open pool."}
      </p>
      <input
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={mine ? "Why? (optional, but it helps)" : "Reason (optional)"}
        className="w-full rounded-lg border border-line bg-raised px-2.5 py-1.5 text-xs placeholder:text-ink-3 focus:border-accent focus:outline-none"
      />
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="rounded-lg bg-warn px-3 py-1.5 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Moving…" : "Put it back"}
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
