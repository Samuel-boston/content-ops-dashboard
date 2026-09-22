"use client";

import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { approveCarouselScriptAction } from "@/app/pipeline-actions";
import { IconChevronRight } from "@/components/ui/icons";

/** Approve a carousel's script — Script Review -> Creative Review, where the actual slide images get checked. */
export function ApproveCarouselButton({ videoId }: { videoId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTrackedTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await approveCarouselScriptAction(videoId);
          if (res?.error) toast.error(res.error);
          else {
            toast.success("Approved — creatives to review.");
            router.refresh();
          }
        })
      }
      className="flex shrink-0 items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-2 transition hover:border-accent hover:text-ink disabled:opacity-50"
    >
      Approve — review creatives
      <IconChevronRight size={11} />
    </button>
  );
}
