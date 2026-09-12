import { STALLED_AFTER_DAYS, type Video, type VideoStatus } from "@/lib/types";

export interface PriorityInsight {
  key: string;
  label: string;
  count: number;
  tone: "critical" | "warn" | "info" | "good";
  href: string;
  examples: string[];
}

type Sliver = Pick<
  Video,
  "id" | "title" | "status" | "priority" | "stage_entered_at" | "post_date" | "assigned_editor_id"
>;

export function isStalledRow(v: Pick<Sliver, "status" | "stage_entered_at">, now = Date.now()) {
  const limit = STALLED_AFTER_DAYS[v.status as VideoStatus];
  return Boolean(limit && now - new Date(v.stage_entered_at).getTime() > limit * 864e5);
}

export function daysInStage(v: Pick<Sliver, "stage_entered_at">, now = Date.now()) {
  return Math.floor((now - new Date(v.stage_entered_at).getTime()) / 864e5);
}

/**
 * "What should be priority going into the coming week" — derived from the
 * pipeline rather than asked for. Shared by the Overview page and the weekly
 * Telegram/email report so the two never disagree.
 */
export function computePriorities(videos: Sliver[], now = Date.now()): PriorityInsight[] {
  const today = new Date(now).toISOString().slice(0, 10);
  const weekEnd = new Date(now + 7 * 864e5).toISOString().slice(0, 10);
  const titles = (rows: Sliver[]) => rows.slice(0, 3).map((v) => v.title);

  const unclaimedUrgent = videos.filter(
    (v) => v.status === "ready_to_edit" && v.priority !== "standard" && !v.assigned_editor_id
  );
  const stuck = videos.filter((v) => v.status !== "posted" && isStalledRow(v, now));
  const awaitingReview = videos.filter((v) => v.status === "in_review");
  const inRevisions = videos.filter((v) => v.status === "revisions");
  const postingSoon = videos.filter(
    (v) => v.status !== "posted" && v.post_date && v.post_date >= today && v.post_date <= weekEnd
  );
  const approvedNoDate = videos.filter((v) => v.status === "approved" && !v.post_date);
  const poolEmpty = videos.filter((v) => v.status === "ready_to_edit").length === 0;

  const out: PriorityInsight[] = [];

  if (unclaimedUrgent.length)
    out.push({
      key: "unclaimed",
      label: `${unclaimedUrgent.length} urgent/high still unassigned`,
      count: unclaimedUrgent.length,
      tone: "critical",
      href: "/ready-to-edit",
      examples: titles(unclaimedUrgent),
    });

  if (stuck.length)
    out.push({
      key: "stalled",
      label: `${stuck.length} stalled in one stage`,
      count: stuck.length,
      tone: "critical",
      href: "/board",
      examples: titles(stuck),
    });

  if (awaitingReview.length)
    out.push({
      key: "review",
      label: `${awaitingReview.length} waiting on review`,
      count: awaitingReview.length,
      tone: "warn",
      href: "/board",
      examples: titles(awaitingReview),
    });

  if (inRevisions.length)
    out.push({
      key: "revisions",
      label: `${inRevisions.length} in revisions`,
      count: inRevisions.length,
      tone: "warn",
      href: "/board",
      examples: titles(inRevisions),
    });

  if (approvedNoDate.length)
    out.push({
      key: "unscheduled",
      label: `${approvedNoDate.length} approved with no post date`,
      count: approvedNoDate.length,
      tone: "warn",
      href: "/publishing",
      examples: titles(approvedNoDate),
    });

  if (postingSoon.length)
    out.push({
      key: "posting",
      label: `${postingSoon.length} posting in the next 7 days`,
      count: postingSoon.length,
      tone: "info",
      href: "/calendar",
      examples: titles(postingSoon),
    });

  if (poolEmpty)
    out.push({
      key: "empty-pool",
      label: "Ready to Edit is empty — more needs filming",
      count: 0,
      tone: "critical",
      href: "/ready-to-edit",
      examples: [],
    });

  if (out.length === 0)
    out.push({
      key: "clear",
      label: "Nothing blocking — the pipeline is clear",
      count: 0,
      tone: "good",
      href: "/board",
      examples: [],
    });

  return out;
}

/**
 * Stamp each row with whether its ETA has passed.
 *
 * Done here, in the data layer, rather than inside a component: comparing
 * against `Date.now()` during render is impure, and on a client component it
 * would compute one answer on the server and a different one at hydration.
 */
export function annotateOverdue<T extends { eta_at: string | null }>(
  rows: T[],
  now: number = Date.now()
): (T & { overdue: boolean })[] {
  return rows.map((r) => ({
    ...r,
    overdue: !!r.eta_at && new Date(r.eta_at).getTime() < now,
  }));
}

/**
 * Ideas that have sat untouched too long.
 *
 * The clock read lives here rather than in a component: `Date.now()` during
 * render is impure, drifts between the server pass and hydration, and the
 * lint rule that catches it is the same one `annotateOverdue` exists for.
 */
export function staleIds<T extends { id: string; stage_entered_at: string }>(
  rows: T[],
  days: number,
  now: number = Date.now()
): Set<string> {
  const before = now - days * 864e5;
  return new Set(
    rows.filter((r) => new Date(r.stage_entered_at).getTime() < before).map((r) => r.id)
  );
}

/** "2026-09" for whichever month we're in. Same reason as above. */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
