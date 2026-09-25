import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { baselineOf, classify, MIN_POSTS_FOR_OUTLIERS } from "@/lib/perf-stats";

/** One published post with numbers: a feed post, or one trial reel. */
export interface PerfPost {
  key: string;
  videoId: string;
  title: string;
  /** The opening line: the video's first hook, or the variant's label for a trial. */
  hook: string | null;
  views: number;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  link: string | null;
  postedAt: string;
  kind: "feed" | "trial";
}

export interface PerfOutlier extends PerfPost {
  multiple: number;
  direction: "high" | "low";
  thisWeek: boolean;
}

export interface PerformanceDigest {
  hasData: boolean;
  week: { posts: number; views: number; prevViews: number | null };
  month: { posts: number; views: number };
  /** Median views per post over the recent baseline. */
  typicalViews: number | null;
  topWeek: PerfPost[];
  topMonth: PerfPost[];
  outliers: PerfOutlier[];
}

const DAY = 864e5;

/** Every published post that has views, from feed metrics and from trial numbers. */
export async function collectPosts(db: SupabaseClient): Promise<PerfPost[]> {
  const [{ data: metrics }, { data: trials }, { data: videos }] = await Promise.all([
    db.from("video_metrics").select("video_id, views, likes, comments, shares, saves, permalink, fetched_at"),
    db
      .from("trial_posts")
      .select("id, video_id, label, views, likes, comments, shares, saves, permalink, posted_at, status, winner")
      .in("status", ["posted", "promoted"])
      .not("posted_at", "is", null)
      .not("views", "is", null),
    db.from("videos").select("id, title, status, posted_at, script_hooks"),
  ]);
  const byId = new Map((videos ?? []).map((v) => [v.id as string, v]));
  const out: PerfPost[] = [];

  for (const m of metrics ?? []) {
    const v = byId.get(m.video_id as string);
    if (!v || v.status !== "posted" || !v.posted_at || m.views === null) continue;
    out.push({
      key: `feed:${m.video_id}`,
      videoId: m.video_id as string,
      title: v.title as string,
      hook: ((v.script_hooks as string[] | null) ?? []).find((h) => h?.trim()) ?? null,
      views: Number(m.views),
      likes: m.likes as number | null,
      comments: m.comments as number | null,
      shares: m.shares as number | null,
      saves: m.saves as number | null,
      link: (m.permalink as string | null) ?? null,
      postedAt: v.posted_at as string,
      kind: "feed",
    });
  }
  // A winning trial that went to the feed exists twice: as its trial row and as the feed post's metrics.
  // The feed post is the real one, so the trial row is skipped for that video.
  const hasFeed = new Set(out.map((p) => p.videoId));
  for (const t of trials ?? []) {
    const v = byId.get(t.video_id as string);
    if (!v) continue;
    if (t.winner && hasFeed.has(t.video_id as string)) continue;
    out.push({
      key: `trial:${t.id}`,
      videoId: t.video_id as string,
      title: v.title as string,
      hook: (t.label as string) || null,
      views: Number(t.views),
      likes: t.likes as number | null,
      comments: t.comments as number | null,
      shares: t.shares as number | null,
      saves: t.saves as number | null,
      link: (t.permalink as string | null) ?? null,
      postedAt: t.posted_at as string,
      kind: "trial",
    });
  }
  return out;
}

const byViews = (a: PerfPost, b: PerfPost) => b.views - a.views;

/** What went well this week and this month, and which individual posts stood out. */
export async function buildPerformance(db: SupabaseClient, now = new Date()): Promise<PerformanceDigest> {
  const all = await collectPosts(db);
  const t = now.getTime();
  const within = (p: PerfPost, days: number, from = 0) => {
    const age = t - new Date(p.postedAt).getTime();
    return age >= from * DAY && age <= days * DAY;
  };

  const week = all.filter((p) => within(p, 7));
  const prevWeek = all.filter((p) => within(p, 14, 7));
  const month = all.filter((p) => within(p, 30));
  const sum = (ps: PerfPost[]) => ps.reduce((n, p) => n + p.views, 0);

  // "Usual" = the last 90 days; if that's too thin, everything there is.
  const recent = all.filter((p) => within(p, 90) && p.views > 0);
  const basis = (recent.length >= MIN_POSTS_FOR_OUTLIERS ? recent : all.filter((p) => p.views > 0)).map((p) => p.views);
  const base = baselineOf(basis);

  const outliers: PerfOutlier[] = [];
  for (const p of month) {
    const c = classify(p.views, base);
    if (c) outliers.push({ ...p, multiple: c.multiple, direction: c.direction, thisWeek: within(p, 7) });
  }
  // This week's first; within that the wins lead, then the misses, each loudest first.
  outliers.sort(
    (a, b) =>
      Number(b.thisWeek) - Number(a.thisWeek) ||
      Number(b.direction === "high") - Number(a.direction === "high") ||
      Math.abs(Math.log(b.multiple)) - Math.abs(Math.log(a.multiple))
  );

  return {
    hasData: all.length > 0,
    week: { posts: week.length, views: sum(week), prevViews: prevWeek.length ? sum(prevWeek) : null },
    month: { posts: month.length, views: sum(month) },
    typicalViews: base.n >= MIN_POSTS_FOR_OUTLIERS ? Math.round(base.median) : null,
    topWeek: [...week].sort(byViews).slice(0, 3),
    topMonth: [...month].sort(byViews).slice(0, 5),
    outliers: outliers.slice(0, 5),
  };
}
