"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { deleteVideoAction } from "@/app/pipeline-actions";
import { IconTrash } from "@/components/ui/icons";

/**
 * A bin icon: delete this video for good, heavy files and all. Confirms first
 * because there's no undo. Owner and admin only — the action checks, so a seat
 * that shouldn't have it gets a plain message rather than a deletion.
 */
export function DeleteVideoButton({
  videoId,
  title,
  compact = false,
  /** Where to go once it's gone — the video's own page no longer exists. */
  goTo = "/board",
}: {
  videoId: string;
  title?: string;
  compact?: boolean;
  goTo?: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Delete this video"
        aria-label="Delete this video"
        className={`flex shrink-0 items-center rounded-lg border border-line text-ink-3 transition hover:border-danger hover:text-danger ${
          compact ? "px-1.5 py-1" : "px-2 py-1.5"
        }`}
      >
        <IconTrash size={compact ? 12 : 14} />
      </button>
      <ConfirmDialog
        open={open}
        title={title ? `Delete “${title}”?` : "Delete this video?"}
        body="This permanently removes the video, its cuts and heavy files, comments, slides and everything else attached. It can't be undone. Anything already archived to Google Drive stays there."
        confirmLabel={pending ? "Deleting…" : "Delete it"}
        cancelLabel="Keep it"
        onCancel={() => setOpen(false)}
        onConfirm={() =>
          startTransition(async () => {
            const res = await deleteVideoAction(videoId);
            setOpen(false);
            if (res && "error" in res && res.error) return toast.error(res.error);
            toast.success("Deleted.");
            router.push(goTo);
            router.refresh();
          })
        }
      />
    </>
  );
}
