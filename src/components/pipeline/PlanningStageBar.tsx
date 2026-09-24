"use client";

import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useClientName } from "@/components/ClientName";
import { setPlanningStageAction } from "@/app/pipeline-actions";
import { IconCheck } from "@/components/ui/icons";
import { STATUS_COLOR, STATUS_LABELS, type VideoStatus } from "@/lib/types";

type PlanningStage =
  | "ideation"
  | "scripting"
  | "ready_to_film"
  | "editor_brief"
  | "ready_to_edit";

const STAGES: PlanningStage[] = [
  "ideation",
  "scripting",
  "ready_to_film",
  "editor_brief",
  "ready_to_edit",
];

/**
 * The planning stages as a stepper you can actually operate.
 *
 * The point is that finishing a script and saying so is one gesture in one
 * place — previously you had to leave the script, find the video on a list,
 * and move it from there. It steps backwards too: an idea that turned out to
 * need more thought should be able to go back to Ideation without a detour.
 *
 * Ready to Edit is the last stop here because it's the handover — past it the
 * video belongs to the editors and the pipeline's own triggers own the routing.
 */
export function PlanningStageBar({
  videoId,
  current,
  canEdit,
  carousel = false,
  lockedStages = [],
}: {
  videoId: string;
  current: VideoStatus;
  canEdit: boolean;
  /** Carousels don't get filmed — Ready to Film never applies to them. */
  carousel?: boolean;
  /** Stages this viewer may not move a video into — shown but greyed out. */
  lockedStages?: PlanningStage[];
}) {
  const toast = useToast();
  const clientName = useClientName();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();

  // A carousel never gets filmed, briefed, or handed to an editor — once its
  // script is approved it goes on to creatives, outside this stepper entirely.
  const stages = carousel
    ? STAGES.filter((s) => !["ready_to_film", "editor_brief", "ready_to_edit"].includes(s))
    : STAGES;
  const currentIndex = stages.indexOf(current as PlanningStage);
  // Past the handover the video is the editors' — show where it got to, but
  // don't offer to drag it back into planning from here.
  const beyondPlanning = currentIndex === -1;

  function move(to: PlanningStage) {
    if (to === current) return;
    startTransition(async () => {
      const res = await setPlanningStageAction(videoId, to);
      if (res?.error) toast.error(res.error);
      else {
        toast.success(`Moved to ${STATUS_LABELS[to]}.`);
        router.refresh();
      }
    });
  }

  if (beyondPlanning) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-2">
        <span
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]"
          style={{
            color: STATUS_COLOR[current],
            background: `color-mix(in srgb, ${STATUS_COLOR[current]} 12%, transparent)`,
          }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[current] }} />
          {STATUS_LABELS[current]}
        </span>
        <span className="text-[11px] text-ink-3">
          {carousel
            ? "Past scripting — see the Carousels board for what's next."
            : "Out of planning — the editors have this one now."}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-card p-2">
      <div className="flex flex-wrap items-center gap-1">
        {stages.map((stage, i) => {
          const isCurrent = i === currentIndex;
          const isDone = i < currentIndex;
          const colour = STATUS_COLOR[stage];

          return (
            <div key={stage} className="flex min-w-0 items-center gap-1">
              {i > 0 ? (
                <span
                  aria-hidden
                  className="h-px w-3 shrink-0"
                  style={{ background: isDone || isCurrent ? colour : "var(--color-line)" }}
                />
              ) : null}
              <button
                type="button"
                disabled={!canEdit || pending || isCurrent || lockedStages.includes(stage)}
                onClick={() => move(stage)}
                aria-current={isCurrent ? "step" : undefined}
                title={
                  isCurrent
                    ? `Currently in ${STATUS_LABELS[stage]}`
                    : lockedStages.includes(stage)
                      ? `Only ${clientName} can move a script to ${STATUS_LABELS[stage]}`
                      : canEdit
                      ? `Move to ${STATUS_LABELS[stage]}`
                      : STATUS_LABELS[stage]
                }
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] transition disabled:cursor-default ${
                  isCurrent
                    ? "font-medium"
                    : canEdit
                      ? "text-ink-3 hover:bg-hover hover:text-ink"
                      : "text-ink-3"
                } ${pending ? "opacity-60" : ""}`}
                style={
                  isCurrent
                    ? {
                        color: colour,
                        background: `color-mix(in srgb, ${colour} 14%, transparent)`,
                      }
                    : undefined
                }
              >
                {isDone ? (
                  <span style={{ color: colour }}>
                    <IconCheck size={11} />
                  </span>
                ) : (
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: isCurrent ? colour : "var(--color-line-strong)" }}
                  />
                )}
                {STATUS_LABELS[stage]}
              </button>
            </div>
          );
        })}
        {canEdit ? (
          <span className="ml-auto pl-2 text-[10px] text-ink-3">Click a stage to move this</span>
        ) : null}
      </div>
    </div>
  );
}
