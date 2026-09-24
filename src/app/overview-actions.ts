"use server";

import { supabaseServer } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { STATUS_LABELS, type VideoActivity, type VideoMetrics, type VideoStatus } from "@/lib/types";

/* ------------------------------------------------------------ performance -- */

export interface PeriodStats {
  posts: number;
  views: number;
  reach: number;
  engagements: number;
  /** Reactions per person reached. Null when nothing in the period has numbers. */
  engagementRate: number | null;
  best: { id: string; title: string; views: number } | null;
}

export interface Performance {
  monthToDate: PeriodStats;
  last30: PeriodStats;
  /** Last 30 days against the 30 before it. Null when there's no prior period. */
  viewsTrend: number | null;
  /** True when nothing posted has metrics yet — the panel says so rather than showing zeroes. */
  awaitingMetrics: boolean;
  /** Views per month, oldest first, for the trend bar — six months back, zero-filled. */
  monthly: { month: string; views: number; posts: number }[];
}

function summarise(
  rows: { id: string; title: string; posted_at: string | null }[],
  metrics: Map<string, VideoMetrics>
): PeriodStats {
  let views = 0;
  let reach = 0;
  let engagements = 0;
  let best: PeriodStats["best"] = null;

  for (const v of rows) {
    const m = metrics.get(v.id);
    const vv = m?.views ?? 0;
    views += vv;
    reach += m?.reach ?? 0;
    engagements += (m?.likes ?? 0) + (m?.comments ?? 0) + (m?.shares ?? 0) + (m?.saves ?? 0);
    if (m && (!best || vv > best.views)) best = { id: v.id, title: v.title, views: vv };
  }

  // Reach is the honest denominator — views double-count the same person.
  const base = reach || views;
  return {
    posts: rows.length,
    views,
    reach,
    engagements,
    engagementRate: base ? engagements / base : null,
    best,
  };
}

/**
 * The small analytics block on the Overview.
 *
 * Deliberately not a second Analytics page: two periods, four numbers each,
 * and the one video worth clicking. Anything that needs a filter belongs on
 * /analytics.
 */
export async function performance(): Promise<Performance> {
  await requireUser();
  const supabase = await supabaseServer();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const d30 = new Date(now.getTime() - 30 * 864e5).toISOString();
  const d60 = new Date(now.getTime() - 60 * 864e5).toISOString();
  // Six calendar months back, for the trend bar — wider than the 60-day
  // window the other stats need, so it's a separate bound on the same query.
  const monthsBack = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();

  const [{ data: videos }, { data: metricRows }] = await Promise.all([
    supabase
      .from("videos")
      .select("id, title, posted_at")
      .eq("status", "posted")
      .not("posted_at", "is", null)
      .gte("posted_at", monthsBack)
      .order("posted_at", { ascending: false }),
    supabase.from("video_metrics").select("*"),
  ]);

  const rows = (videos as { id: string; title: string; posted_at: string }[]) ?? [];
  const metrics = new Map(((metricRows as VideoMetrics[]) ?? []).map((m) => [m.video_id, m]));

  const inMonth = rows.filter((v) => v.posted_at >= monthStart);
  const in30 = rows.filter((v) => v.posted_at >= d30);
  const prior30 = rows.filter((v) => v.posted_at < d30 && v.posted_at >= d60);

  const last30 = summarise(in30, metrics);
  const previous = summarise(prior30, metrics);

  // Six months, oldest first, zero-filled — a video with no metrics yet still
  // counts toward "posts" so a busy, unmeasured month isn't drawn as empty.
  const monthly: { month: string; views: number; posts: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const inThisMonth = rows.filter((v) => v.posted_at.slice(0, 7) === key);
    monthly.push({
      month: key,
      views: inThisMonth.reduce((n, v) => n + (metrics.get(v.id)?.views ?? 0), 0),
      posts: inThisMonth.length,
    });
  }

  return {
    monthToDate: summarise(inMonth, metrics),
    last30,
    viewsTrend:
      previous.views > 0 ? (last30.views - previous.views) / previous.views : null,
    awaitingMetrics: rows.length > 0 && rows.every((v) => !metrics.has(v.id)),
    monthly,
  };
}

/* ---------------------------------------------------------------- runway -- */

export interface Runway {
  /** Scheduled posts still ahead of today. */
  scheduled: number;
  /** The last date anything is booked to go out. */
  lastDate: string | null;
  /** Days from today to that date. Null when nothing is scheduled ahead. */
  daysLeft: number | null;
  /** What's behind it, stage by stage, in pipeline order. */
  depth: { label: string; count: number; href: string }[];
  /** Everything not yet posted — the total the runway is drawn from. */
  totalUnposted: number;
}

/**
 * How long until the pipeline runs dry.
 *
 * The most alarming number in a content operation is the date after which
 * nothing is scheduled, and nothing on the dashboard said it. The stage counts
 * below it answer the follow-up: is there anything behind it, and at which end
 * is the shortage?
 */
export async function runway(): Promise<Runway> {
  await requireUser();
  const supabase = await supabaseServer();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: scheduled }, { data: unposted }] = await Promise.all([
    supabase
      .from("videos")
      .select("post_date")
      .is("parked_at", null)
      .neq("status", "posted")
      .not("post_date", "is", null)
      .gte("post_date", today)
      .order("post_date", { ascending: false }),
    supabase.from("videos").select("status").neq("status", "posted").is("parked_at", null),
  ]);

  const dates = ((scheduled as { post_date: string }[]) ?? []).map((r) => r.post_date);
  const lastDate = dates[0] ?? null;
  const daysLeft = lastDate
    ? Math.round(
        (new Date(`${lastDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) /
          864e5
      )
    : null;

  const statuses = ((unposted as { status: string }[]) ?? []).map((r) => r.status);
  const count = (s: string) => statuses.filter((x) => x === s).length;

  return {
    scheduled: dates.length,
    lastDate,
    daysLeft,
    totalUnposted: statuses.length,
    depth: [
      { label: "Ideas", count: count("ideation"), href: "/ideation" },
      { label: "Scripting", count: count("scripting"), href: "/scripting" },
      { label: "To film", count: count("ready_to_film"), href: "/filming" },
      { label: "Editor brief", count: count("editor_brief"), href: "/editor-brief" },
      { label: "With editors", count: count("ready_to_edit") + count("in_progress"), href: "/board" },
    ],
  };
}

/* -------------------------------------------------------------- what's new -- */

export interface WhatsNewGroup {
  /** The stage this line is about, or "other" for the folded-together minor moves. */
  status: VideoStatus | "other";
  count: number;
  /** "2 videos to review" — already pluralised. */
  label: string;
  href: string;
}

export interface WhatsNew {
  /** Clock stamped at fetch time, so the view never reads it during render. */
  now: number;
  since: string | null;
  /** Raw recent moves — kept for Andreas's ranking, not shown one-by-one. */
  items: (VideoActivity & { video_title: string | null })[];
  /** The same moves rolled up: one line per destination stage, with a count. */
  groups: WhatsNewGroup[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Stages that mean "your turn" come first, then the rest in pipeline order. */
const GROUP_ORDER: VideoStatus[] = [
  "script_review",
  "creative_review",
  "in_review",
  "final_review",
  "revisions",
  "ready_to_film",
  "ready_to_post",
  "with_va",
  "posted",
];

function groupLabel(status: VideoStatus, n: number): { label: string; href: string } {
  switch (status) {
    case "script_review":
      return { label: plural(n, "script to review", "scripts to review"), href: "/script-review" };
    case "creative_review":
      return { label: plural(n, "creative to review", "creatives to review"), href: "/board" };
    case "in_review":
      return { label: plural(n, "video to review", "videos to review"), href: "/review" };
    case "final_review":
      return { label: plural(n, "video ready for final review", "videos ready for final review"), href: "/review" };
    case "ready_to_film":
      return { label: plural(n, "video ready to film", "videos ready to film"), href: "/filming" };
    case "ready_to_post":
      return { label: plural(n, "video ready to post", "videos ready to post"), href: "/board" };
    case "with_va":
      return { label: plural(n, "video with the VA", "videos with the VA"), href: "/board" };
    case "posted":
      return { label: plural(n, "video posted", "videos posted"), href: "/archive" };
    default:
      return {
        label: `${plural(n, "video", "videos")} moved to ${STATUS_LABELS[status]}`,
        href: "/board",
      };
  }
}

/**
 * Movement since this person last opened the Overview.
 *
 * Own actions are filtered out — you don't need telling what you just did.
 * Moves are rolled up per stage ("3 videos to review") rather than listed per
 * video, and a video that moved several times counts once, at where it landed.
 * The watermark is only advanced by `markOverviewSeenAction`, called from the
 * page after render, so the list survives the render that displays it.
 */
export async function whatsNew(limit = 8): Promise<WhatsNew> {
  const me = await requireUser();
  const supabase = await supabaseServer();

  // First visit: show the last day rather than nothing at all.
  const since = me.overview_seen_at ?? new Date(Date.now() - 864e5).toISOString();

  const { data } = await supabase
    .from("video_activity")
    .select("*, actor:profiles!video_activity_actor_id_fkey (id, full_name, email), video:videos (title)")
    .gt("created_at", since)
    .neq("actor_id", me.id)
    .order("created_at", { ascending: false })
    .limit(300);

  const rows = ((data as (VideoActivity & { video: { title: string } | null })[]) ?? []).map(
    (a) => ({ ...a, video_title: a.video?.title ?? null })
  );

  // Newest first, so the first status move seen for a video is where it ended up.
  const landed = new Map<string, VideoStatus>();
  for (const a of rows) {
    if (a.kind !== "status" || landed.has(a.video_id)) continue;
    const to = a.summary.match(/→ (\w+)$/)?.[1] as VideoStatus | undefined;
    if (to && STATUS_LABELS[to]) landed.set(a.video_id, to);
  }
  const counts = new Map<VideoStatus, number>();
  for (const to of landed.values()) counts.set(to, (counts.get(to) ?? 0) + 1);

  const rank = (s: VideoStatus) => {
    const i = GROUP_ORDER.indexOf(s);
    return i === -1 ? GROUP_ORDER.length : i;
  };
  // Only the stages that mean something to the client get their own line;
  // everything else (ideas shuffling, editors picking things up) folds into
  // one quiet "other" line rather than a wall of small notices.
  const main = [...counts.entries()].filter(([s]) => GROUP_ORDER.includes(s));
  const minor = [...counts.entries()].filter(([s]) => !GROUP_ORDER.includes(s));
  const groups: WhatsNewGroup[] = main
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([status, count]) => ({ status, count, ...groupLabel(status, count) }));
  const minorCount = minor.reduce((n, [, c]) => n + c, 0);
  if (minorCount > 0) {
    groups.push({
      status: "other",
      count: minorCount,
      label: `${plural(minorCount, "other video", "other videos")} moved along`,
      href: "/board",
    });
  }

  return { now: Date.now(), since: me.overview_seen_at, items: rows.slice(0, limit), groups };
}

/** Move the watermark forward. Called once the Overview has been rendered. */
export async function markOverviewSeenAction() {
  const me = await requireUser();
  const supabase = await supabaseServer();
  await supabase
    .from("profiles")
    .update({ overview_seen_at: new Date().toISOString() })
    .eq("id", me.id);
  return { ok: true };
}

/* --------------------------------------------------------- stalled/overdue -- */

export interface StalledVideo {
  id: string;
  title: string;
  priority: import("@/lib/types").Priority;
  status: import("@/lib/types").VideoStatus;
  overdue: boolean;
  eta_at: string | null;
  eta_stage: import("@/lib/types").VideoStatus | null;
  stage_entered_at: string;
}

/**
 * Videos gone quiet — stalled in their stage, or past the ETA someone gave.
 * Lives in the nav now, not the Overview body, so it reads as an alert (like
 * a notification) rather than another block of the page competing with
 * Performance and Runway for attention. Deliberately a narrow select — the
 * board's own listing already pulls everything else.
 */
export async function listStalledOverdue(): Promise<StalledVideo[]> {
  await requireUser();
  const { annotateOverdue, isStalledRow } = await import("@/lib/priorities");
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("videos")
    .select("id, title, priority, status, eta_at, eta_stage, stage_entered_at")
    .is("parked_at", null)
    .neq("status", "posted")
    .order("stage_entered_at", { ascending: true });

  const rows = (data as Omit<StalledVideo, "overdue">[]) ?? [];
  const annotated = annotateOverdue(rows);
  const stalled = annotated.filter((v) => isStalledRow(v));
  const overdue = annotated.filter((v) => v.overdue);
  // A video both stalled and past its ETA should appear once, not twice.
  return [...new Map([...overdue, ...stalled].map((v) => [v.id, v])).values()];
}

/**
 * An editor's own version of the caution bell above — scoped to just what's
 * assigned to them. The manager's version deliberately includes the whole
 * unclaimed pool (a nudge to get it claimed); that's not "on" any one editor,
 * so it's left out here rather than showing someone a pile of stalled work
 * that isn't theirs.
 */
export async function listMyStalledOverdue(): Promise<StalledVideo[]> {
  const me = await requireUser();
  const { annotateOverdue, isStalledRow } = await import("@/lib/priorities");
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("videos")
    .select("id, title, priority, status, eta_at, eta_stage, stage_entered_at")
    .eq("assigned_editor_id", me.id)
    .is("parked_at", null)
    .neq("status", "posted")
    .order("stage_entered_at", { ascending: true });

  const rows = (data as Omit<StalledVideo, "overdue">[]) ?? [];
  const annotated = annotateOverdue(rows);
  const stalled = annotated.filter((v) => isStalledRow(v));
  const overdue = annotated.filter((v) => v.overdue);
  return [...new Map([...overdue, ...stalled].map((v) => [v.id, v])).values()];
}
