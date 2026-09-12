import type { VideoMetrics, VideoWithEditor } from "@/lib/types";

/**
 * A posted video joined to whatever Instagram gave us for it.
 *
 * Instagram's Graph API returns six numbers: views, reach, likes, comments,
 * shares and saves. There is no retention curve and no watch time, so every
 * insight below is derived from those six plus what we already know about the
 * video (length, pillar, format, when it went out).
 */
export interface Insight {
  id: string;
  title: string;
  postedAt: string | null;
  postDate: string | null;
  durationSeconds: number | null;
  pillars: string[];
  formats: string[];
  platforms: string[];
  editorId: string | null;
  views: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  /** Reactions per person reached — the closest thing to "did it land". */
  engagementRate: number;
  /** Saves + shares per person reached. Intent, rather than applause. */
  intentRate: number;
}

export interface Filters {
  pillar?: string;
  format?: string;
  platform?: string;
  editorId?: string;
  from?: string;
  to?: string;
  lengthBucket?: string;
}

export function buildInsights(
  videos: VideoWithEditor[],
  metrics: VideoMetrics[],
  durations: Map<string, number | null>
): Insight[] {
  const byVideo = new Map(metrics.map((m) => [m.video_id, m]));
  return videos.map((v) => {
    const m = byVideo.get(v.id);
    const views = m?.views ?? 0;
    const reach = m?.reach ?? 0;
    const likes = m?.likes ?? 0;
    const comments = m?.comments ?? 0;
    const shares = m?.shares ?? 0;
    const saves = m?.saves ?? 0;
    const base = reach || views || 0;
    return {
      id: v.id,
      title: v.title,
      postedAt: v.posted_at,
      postDate: v.post_date,
      durationSeconds: durations.get(v.id) ?? null,
      pillars: v.content_pillars ?? [],
      formats: v.formats ?? [],
      platforms: v.platforms ?? [],
      editorId: v.assigned_editor_id,
      views,
      reach,
      likes,
      comments,
      shares,
      saves,
      engagementRate: base ? (likes + comments + shares + saves) / base : 0,
      intentRate: base ? (saves + shares) / base : 0,
    };
  });
}

/** Duration buckets, in the shape short-form actually gets cut. */
export const LENGTH_BUCKETS: { key: string; label: string; min: number; max: number }[] = [
  { key: "0-15", label: "Under 15s", min: 0, max: 15 },
  { key: "15-30", label: "15–30s", min: 15, max: 30 },
  { key: "30-45", label: "30–45s", min: 30, max: 45 },
  { key: "45-60", label: "45–60s", min: 45, max: 60 },
  { key: "60-90", label: "60–90s", min: 60, max: 90 },
  { key: "90+", label: "Over 90s", min: 90, max: Infinity },
];

export function bucketFor(seconds: number | null): string | null {
  if (seconds == null) return null;
  return LENGTH_BUCKETS.find((b) => seconds >= b.min && seconds < b.max)?.key ?? null;
}

export function applyFilters(rows: Insight[], f: Filters): Insight[] {
  return rows.filter((r) => {
    if (f.pillar && !r.pillars.includes(f.pillar)) return false;
    if (f.format && !r.formats.includes(f.format)) return false;
    if (f.platform && !r.platforms.includes(f.platform)) return false;
    if (f.editorId && r.editorId !== f.editorId) return false;
    if (f.lengthBucket && bucketFor(r.durationSeconds) !== f.lengthBucket) return false;
    const when = r.postDate ?? r.postedAt?.slice(0, 10) ?? null;
    if (f.from && (!when || when < f.from)) return false;
    if (f.to && (!when || when > f.to)) return false;
    return true;
  });
}

export interface Group {
  key: string;
  label: string;
  count: number;
  avgViews: number;
  avgReach: number;
  avgEngagement: number;
  totalViews: number;
}

function summarise(key: string, label: string, rows: Insight[]): Group {
  const n = rows.length || 1;
  return {
    key,
    label,
    count: rows.length,
    avgViews: Math.round(rows.reduce((a, r) => a + r.views, 0) / n),
    avgReach: Math.round(rows.reduce((a, r) => a + r.reach, 0) / n),
    avgEngagement: rows.reduce((a, r) => a + r.engagementRate, 0) / n,
    totalViews: rows.reduce((a, r) => a + r.views, 0),
  };
}

/** Group by a multi-value field (a video can carry several pillars). */
export function groupByTag(rows: Insight[], field: "pillars" | "formats" | "platforms"): Group[] {
  const map = new Map<string, Insight[]>();
  for (const r of rows) {
    for (const tag of r[field]) {
      const list = map.get(tag) ?? [];
      list.push(r);
      map.set(tag, list);
    }
  }
  return [...map.entries()]
    .map(([tag, list]) => summarise(tag, tag, list))
    .sort((a, b) => b.avgViews - a.avgViews);
}

export function groupByLength(rows: Insight[]): Group[] {
  return LENGTH_BUCKETS.map((b) =>
    summarise(b.key, b.label, rows.filter((r) => bucketFor(r.durationSeconds) === b.key))
  ).filter((g) => g.count > 0);
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function groupByWeekday(rows: Insight[]): Group[] {
  const map = new Map<number, Insight[]>();
  for (const r of rows) {
    const when = r.postDate ?? r.postedAt?.slice(0, 10);
    if (!when) continue;
    const d = new Date(`${when}T00:00:00`).getDay();
    const list = map.get(d) ?? [];
    list.push(r);
    map.set(d, list);
  }
  return [...map.entries()]
    .map(([d, list]) => summarise(String(d), DAYS[d], list))
    .sort((a, b) => b.avgViews - a.avgViews);
}

/** Month-by-month totals, oldest first. */
export function byMonth(rows: Insight[]): { month: string; count: number; avgViews: number }[] {
  const map = new Map<string, Insight[]>();
  for (const r of rows) {
    const when = r.postDate ?? r.postedAt?.slice(0, 10);
    if (!when) continue;
    const key = when.slice(0, 7);
    const list = map.get(key) ?? [];
    list.push(r);
    map.set(key, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, list]) => ({
      month,
      count: list.length,
      avgViews: Math.round(list.reduce((a, r) => a + r.views, 0) / (list.length || 1)),
    }));
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface Outlier {
  insight: Insight;
  multiple: number;
  reasons: string[];
}

/**
 * Videos that beat the median by a wide margin, with what they had in common
 * that the rest didn't — the "what was different" the client actually wants.
 */
export function findOutliers(rows: Insight[], threshold = 1.8): Outlier[] {
  const med = median(rows.map((r) => r.views).filter((v) => v > 0));
  if (!med) return [];

  const pillarAvg = new Map(groupByTag(rows, "pillars").map((g) => [g.key, g.avgViews]));
  const formatAvg = new Map(groupByTag(rows, "formats").map((g) => [g.key, g.avgViews]));

  return rows
    .filter((r) => r.views >= med * threshold)
    .map((r) => {
      const reasons: string[] = [];
      const bucket = LENGTH_BUCKETS.find((b) => b.key === bucketFor(r.durationSeconds));
      if (bucket) reasons.push(bucket.label);
      for (const p of r.pillars) {
        if ((pillarAvg.get(p) ?? 0) > med) reasons.push(p);
      }
      for (const f of r.formats) {
        if ((formatAvg.get(f) ?? 0) > med) reasons.push(f);
      }
      if (r.intentRate > 0.02) reasons.push("high saves & shares");
      return { insight: r, multiple: r.views / med, reasons: [...new Set(reasons)].slice(0, 4) };
    })
    .sort((a, b) => b.multiple - a.multiple);
}

/**
 * The plain-English answer. A chart needs reading; a sentence gets acted on.
 * Returns null when there isn't enough posted work to say anything honest.
 */
export function whatsWorking(rows: Insight[]): { line: string; parts: string[] } | null {
  const withViews = rows.filter((r) => r.views > 0);
  if (withViews.length < 4) return null;

  const parts: string[] = [];
  const best = <T extends Group>(groups: T[], minCount = 2) =>
    groups.filter((g) => g.count >= minCount)[0];

  const format = best(groupByTag(withViews, "formats"));
  const length = best(groupByLength(withViews));
  const pillar = best(groupByTag(withViews, "pillars"));
  const day = best(groupByWeekday(withViews));

  if (format) parts.push(format.label.toLowerCase());
  if (length) parts.push(length.label.toLowerCase());
  if (pillar) parts.push(pillar.label.toLowerCase());
  if (day) parts.push(`posted on ${day.label}`);

  if (parts.length < 2) return null;
  return {
    line: `Your strongest videos are ${parts.join(", ")}.`,
    parts,
  };
}
