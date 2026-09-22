"use client";

import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { stepBackStageAction } from "@/app/pipeline-actions";
import { IconChevronLeft } from "@/components/ui/icons";
import { previousStage, STATUS_LABELS, type VideoStatus } from "@/lib/types";

/**
 * Undo the last stage move.
 *
 * Quieter than the forward action next to it on purpose — going back is the
 * rarer intent, and this shouldn't compete with the button people actually
 * came to press. Renders nothing at the first stage, so there's never a
 * control that can only fail.
 */
export function StageBack({
  videoId,
  status,
  compact = false,
  carousel = false,
}: {
  videoId: string;
  status: VideoStatus;
  compact?: boolean;
  carousel?: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();

  const back = previousStage(status, carousel);
  if (!back) return null;

  return (
    <button
      type="button"
      disabled={pending}
      title={`Move back to ${STATUS_LABELS[back]}`}
      onClick={() =>
        startTransition(async () => {
          const res = await stepBackStageAction(videoId);
          if (res?.error) toast.error(res.error);
          else {
            toast.success(`Back to ${STATUS_LABELS[back]}.`);
            router.refresh();
          }
        })
      }
      className={`flex shrink-0 items-center gap-1 rounded-lg text-ink-3 transition hover:bg-hover hover:text-ink-2 disabled:opacity-50 ${
        compact ? "px-1.5 py-1 text-[10px]" : "px-2 py-1.5 text-[11px]"
      }`}
    >
      <IconChevronLeft size={compact ? 10 : 11} />
      {compact ? "Back" : `Back to ${STATUS_LABELS[back]}`}
    </button>
  );
}
