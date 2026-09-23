import { STATUS_OWNER, type VideoStatus, type VideoWithEditor } from "@/lib/types";
import { daysInStage } from "@/lib/priorities";

/**
 * The editor's task board — "My Work", reorganised.
 *
 * The month-grouped view (kept elsewhere, as reference) answers "what have I
 * been paid for". This answers the question an editor actually opens the
 * dashboard to ask: "what do I need to do right now, and why". Grouping is by
 * task type, not by stage label, because "Editing" alone doesn't say whether a
 * first cut is owed or a draft is already up and just needs finishing.
 */
export type TaskKind = "revisions" | "first_cut" | "variants" | "in_progress" | "other";

export interface TaskItem {
  video: VideoWithEditor;
  kind: TaskKind;
  /** Days since the video entered its current stage. */
  daysInStage: number;
  /** True once the promised eta_at has passed. */
  overdue: boolean;
}

export interface TaskGroups {
  /** The client asked for changes. */
  revisions: TaskItem[];
  /** Claimed, nothing uploaded yet — the ETA promised at claim time is owed. */
  firstCut: TaskItem[];
  /** Approved, hook variants still to cut. No formal ETA — aging is the signal. */
  variants: TaskItem[];
  /** Claimed, a draft is already uploaded, not yet submitted for review. */
  inProgress: TaskItem[];
  /** Any other stage where the ball is genuinely in this editor's court. */
  other: TaskItem[];
  /** Submitted — the ball is with the client. Shown so the board reads as the whole picture. */
  waiting: TaskItem[];
}

export function totalTasks(g: TaskGroups): number {
  return (
    g.revisions.length + g.firstCut.length + g.variants.length + g.inProgress.length + g.other.length
  );
}

/**
 * Build the grouped task board from an editor's assigned, unposted videos.
 *
 * `hasCut` is a video-id set: which of these videos already have at least one
 * uploaded version on their main cut. That single bit of external state is
 * what separates "needs a first cut delivered" from "still editing" — both
 * are `in_progress`, and only the upload table can tell them apart.
 */
export function buildTaskGroups(
  videos: VideoWithEditor[],
  hasCut: Set<string>,
  // Defaulted so callers never read the clock during render (impure — drifts
  // between the server pass and hydration).
  now: number = Date.now()
): TaskGroups {
  const groups: TaskGroups = { revisions: [], firstCut: [], variants: [], inProgress: [], other: [], waiting: [] };

  for (const v of videos) {
    const item: TaskItem = {
      video: v,
      kind: "other",
      daysInStage: daysInStage(v, now),
      overdue: Boolean(v.eta_at && new Date(v.eta_at).getTime() < now),
    };

    if (v.status === "revisions") {
      groups.revisions.push({ ...item, kind: "revisions" });
    } else if (v.status === "in_progress") {
      if (hasCut.has(v.id)) groups.inProgress.push({ ...item, kind: "in_progress" });
      else groups.firstCut.push({ ...item, kind: "first_cut" });
    } else if (v.status === "awaiting_variants") {
      groups.variants.push({ ...item, kind: "variants" });
    } else if (v.status === "in_review" || v.status === "final_review") {
      groups.waiting.push(item);
    } else if (STATUS_OWNER[v.status as VideoStatus] === "editor") {
      // Future-proofing: a pipeline stage added later that puts the ball back
      // in the editor's court lands here rather than vanishing from the board.
      groups.other.push(item);
    }
  }

  // Overdue first, then whichever has been waiting longest.
  const bySeverity = (a: TaskItem, b: TaskItem) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return b.daysInStage - a.daysInStage;
  };
  groups.revisions.sort(bySeverity);
  groups.firstCut.sort(bySeverity);
  groups.inProgress.sort(bySeverity);
  groups.other.sort(bySeverity);
  groups.waiting.sort((a, b) => b.daysInStage - a.daysInStage);
  // Variants have no formal ETA — longest-waiting is the only signal, always.
  groups.variants.sort((a, b) => b.daysInStage - a.daysInStage);

  return groups;
}

export type AgingTone = "subtle" | "warn" | "danger";

/**
 * How urgent a hook-variants aging badge should read.
 *
 * Pegged to the app's existing "stalled" threshold for this stage
 * (`STALLED_AFTER_DAYS.awaiting_variants`, currently 3 days) so this view
 * never disagrees with the stalled flag shown elsewhere: danger starts
 * exactly where stalled does.
 */
export function agingTone(days: number, stalledAfter = 3): AgingTone {
  if (days > stalledAfter) return "danger";
  if (days >= Math.ceil(stalledAfter / 2)) return "warn";
  return "subtle";
}
