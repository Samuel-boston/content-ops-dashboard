"use client";

import { useState } from "react";
import { PostedVideoDialog } from "@/components/posting/PostingDialogs";

/** Opens a posted video's performance view — trial numbers, the winner, and posting it to the feed. */
export function ArchivePerformanceButton({ videoId, title, clientName }: { videoId: string; title: string; clientName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-line px-2 py-1 text-[10px] text-ink-2 hover:border-accent hover:text-ink"
      >
        Performance
      </button>
      {open ? <PostedVideoDialog videoId={videoId} title={title} clientName={clientName} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
