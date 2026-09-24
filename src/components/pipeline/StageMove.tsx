"use client";

import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { setPlanningStageAction } from "@/app/pipeline-actions";
import { IconChevronRight } from "@/components/ui/icons";
import { STATUS_LABELS, type VideoStatus } from "@/lib/types";

/** Push an idea along the client's private planning stages. */
export function StageMove({
  videoId,
  to,
  label,
  goTo,
}: {
  videoId: string;
  to: Extract<
    VideoStatus,
    | "ideation"
    | "scripting"
    | "ready_to_film"
    | "editor_brief"
    | "ready_to_edit"
  >;
  label?: string;
  /**
   * Where to land after the move. "Script it" that only changes a status and
   * leaves you on the list is a chore: you then have to go and find the video
   * again under its new stage. Moving and opening is one intent.
   */
  goTo?: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await setPlanningStageAction(videoId, to);
          if (res?.error) toast.error(res.error);
          else if (goTo) {
            router.push(goTo);
          } else {
            toast.success(`Moved to ${STATUS_LABELS[to]}.`);
            router.refresh();
          }
        })
      }
      className="flex shrink-0 items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-2 transition hover:border-accent hover:text-ink disabled:opacity-50"
    >
      {label ?? STATUS_LABELS[to]}
      <IconChevronRight size={11} />
    </button>
  );
}
