"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole, requireUser } from "@/lib/auth";
import { fetchMediaInsights, listRecentMedia } from "@/lib/integrations/instagram";
import type { VideoMetrics, VideoWithEditor } from "@/lib/types";

export async function getVideoMetrics(videoId: string): Promise<VideoMetrics | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("video_metrics")
    .select("*")
    .eq("video_id", videoId)
    .maybeSingle();
  return (data as VideoMetrics | null) ?? null;
}

/** Link a posted video to an Instagram media id and pull its first metrics. */
export async function linkInstagramMediaAction(videoId: string, externalMediaId: string) {
  await requireRole("owner", "admin");
  const db = supabaseAdmin();
  try {
    const ins = await fetchMediaInsights(externalMediaId.trim());
    await db.from("video_metrics").upsert(
      {
        video_id: videoId,
        source: "instagram",
        external_media_id: ins.externalMediaId,
        permalink: ins.permalink,
        views: ins.views,
        likes: ins.likes,
        comments: ins.comments,
        shares: ins.shares,
        saves: ins.saves,
        reach: ins.reach,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "video_id,source" }
    );
    revalidatePath(`/videos/${videoId}`);
    revalidatePath("/analytics");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function refreshAllMetricsAction() {
  await requireRole("owner", "admin");
  const db = supabaseAdmin();
  const { data: rows } = await db
    .from("video_metrics")
    .select("video_id, external_media_id")
    .not("external_media_id", "is", null);
  let updated = 0;
  for (const r of rows ?? []) {
    try {
      const ins = await fetchMediaInsights(r.external_media_id as string);
      await db
        .from("video_metrics")
        .update({
          views: ins.views,
          likes: ins.likes,
          comments: ins.comments,
          shares: ins.shares,
          saves: ins.saves,
          reach: ins.reach,
          permalink: ins.permalink,
          fetched_at: new Date().toISOString(),
        })
        .eq("video_id", r.video_id);
      updated++;
    } catch {
      /* skip */
    }
  }
  revalidatePath("/analytics");
  return { ok: true as const, updated, error: undefined as string | undefined };
}

export async function listRecentIgMediaAction() {
  await requireRole("owner", "admin");
  try {
    return { ok: true, media: await listRecentMedia(25) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---- Account-wide rollup -----------------------------------------------------

export interface RollupRow extends VideoWithEditor {
  metrics: VideoMetrics | null;
}

export async function analyticsRollup(filters: {
  format?: string;
  from?: string;
  to?: string;
}): Promise<{ rows: RollupRow[]; totals: Record<string, number> }> {
  await requireUser();
  const supabase = await supabaseServer();
  let q = supabase
    .from("videos")
    .select(
      "*, assigned_editor:profiles!videos_assigned_editor_id_fkey (id, full_name, email)"
    )
    .eq("status", "posted")
    .order("post_date", { ascending: false });
  if (filters.format) q = q.contains("formats", [filters.format]);
  if (filters.from) q = q.gte("post_date", filters.from);
  if (filters.to) q = q.lte("post_date", filters.to);
  const { data: videos } = await q;

  const ids = (videos ?? []).map((v) => v.id);
  const { data: metrics } = await supabase.from("video_metrics").select("*").in("video_id", ids);
  const byVideo = new Map((metrics ?? []).map((m) => [m.video_id, m as VideoMetrics]));

  const rows: RollupRow[] = ((videos as VideoWithEditor[]) ?? []).map((v) => ({
    ...v,
    metrics: byVideo.get(v.id) ?? null,
  }));

  const totals = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, reach: 0, posts: rows.length };
  for (const r of rows) {
    if (!r.metrics) continue;
    totals.views += r.metrics.views ?? 0;
    totals.likes += r.metrics.likes ?? 0;
    totals.comments += r.metrics.comments ?? 0;
    totals.shares += r.metrics.shares ?? 0;
    totals.saves += r.metrics.saves ?? 0;
    totals.reach += r.metrics.reach ?? 0;
  }
  return { rows, totals };
}

// ---------------------------------------------------------------------------
// Insights — everything the Analytics page reads
// ---------------------------------------------------------------------------

/**
 * Every posted video joined to its metrics and its main cut's duration.
 * Filtering and grouping happen client-side so changing a filter is instant —
 * the dataset is one row per posted video, which stays small for years.
 */
export async function insightRows(): Promise<{
  rows: import("@/lib/insights").Insight[];
  editors: { id: string; full_name: string; email: string }[];
}> {
  await requireUser();
  const supabase = await supabaseServer();

  const [{ data: videos }, { data: metrics }, { data: editors }] = await Promise.all([
    supabase
      .from("videos")
      .select(
        "*, assigned_editor:profiles!videos_assigned_editor_id_fkey (id, full_name, email)"
      )
      .eq("status", "posted")
      .order("posted_at", { ascending: false }),
    supabase.from("video_metrics").select("*"),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "editor")
      .order("full_name"),
  ]);

  const rows = (videos as VideoWithEditor[]) ?? [];

  // Duration comes from the main cut's latest version.
  const durations = new Map<string, number | null>();
  if (rows.length) {
    const { data: cuts } = await supabase
      .from("video_cuts")
      .select("id, video_id")
      .eq("kind", "main")
      .in("video_id", rows.map((v) => v.id));
    const cutToVideo = new Map((cuts ?? []).map((c) => [c.id as string, c.video_id as string]));
    if (cutToVideo.size) {
      const { data: versions } = await supabase
        .from("cut_versions")
        .select("cut_id, version, duration_seconds")
        .in("cut_id", [...cutToVideo.keys()])
        .order("version", { ascending: false });
      for (const v of versions ?? []) {
        const videoId = cutToVideo.get(v.cut_id as string);
        // Versions arrive newest-first, so the first hit per video wins.
        if (videoId && !durations.has(videoId)) {
          durations.set(videoId, (v.duration_seconds as number) ?? null);
        }
      }
    }
  }

  const { buildInsights } = await import("@/lib/insights");
  return {
    rows: buildInsights(rows, (metrics as VideoMetrics[]) ?? [], durations),
    editors: (editors as { id: string; full_name: string; email: string }[]) ?? [],
  };
}

/**
 * How each hook variant performed, for videos that shipped more than one.
 *
 * Instagram reports per *post*, not per cut, so a variant only has numbers of
 * its own once it's been linked to its own media id. Variants without one are
 * returned with `linked: false` rather than being silently dropped — the gap
 * is the point, otherwise the comparison looks complete when it isn't.
 */
export async function hookPerformance(): Promise<
  {
    videoId: string;
    videoTitle: string;
    variants: { cutId: string; label: string; notes: string | null; views: number | null; linked: boolean }[];
  }[]
> {
  await requireUser();
  const supabase = await supabaseServer();

  const { data: videos } = await supabase
    .from("videos")
    .select("id, title")
    .eq("status", "posted");
  if (!videos?.length) return [];

  const { data: cuts } = await supabase
    .from("video_cuts")
    .select("id, video_id, label, kind, notes")
    .in("video_id", videos.map((v) => v.id))
    .order("position");

  const { data: metrics } = await supabase
    .from("video_metrics")
    .select("video_id, views");
  const viewsByVideo = new Map((metrics ?? []).map((m) => [m.video_id as string, m.views as number]));

  return videos
    .map((v) => {
      const mine = (cuts ?? []).filter((c) => c.video_id === v.id);
      if (mine.length < 2) return null;
      return {
        videoId: v.id as string,
        videoTitle: v.title as string,
        variants: mine.map((c) => ({
          cutId: c.id as string,
          label: c.label as string,
          notes: (c.notes as string) ?? null,
          // Only the main cut currently maps to a linked IG post.
          views: c.kind === "main" ? viewsByVideo.get(v.id as string) ?? null : null,
          linked: c.kind === "main" && viewsByVideo.has(v.id as string),
        })),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

/**
 * The trial-reel leaderboard: every video whose hooks were (or are being)
 * trial-tested, its trials ranked by views. Trial numbers are typed in by
 * hand — Instagram's API can't see a reel while it's a trial — so a row with
 * no numbers isn't "zero views", it's "nobody's brought the numbers back
 * yet", and the UI says so.
 */
export interface TrialInsightGroup {
  videoId: string;
  videoTitle: string;
  trials: {
    id: string;
    label: string;
    status: string;
    views: number | null;
    likes: number | null;
    shares: number | null;
    winner: boolean;
    permalink: string | null;
    posted_at: string | null;
  }[];
}

export async function trialInsights(): Promise<TrialInsightGroup[]> {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("trial_posts")
    .select("id, video_id, label, status, views, likes, shares, winner, permalink, posted_at, video:videos (title)")
    .neq("status", "archived")
    .order("created_at", { ascending: true });

  const groups = new Map<string, TrialInsightGroup>();
  for (const t of (data ?? []) as unknown as {
    id: string;
    video_id: string;
    label: string;
    status: string;
    views: number | null;
    likes: number | null;
    shares: number | null;
    winner: boolean;
    permalink: string | null;
    posted_at: string | null;
    video: { title: string } | null;
  }[]) {
    const g = groups.get(t.video_id) ?? {
      videoId: t.video_id,
      videoTitle: t.video?.title ?? "Untitled",
      trials: [],
    };
    g.trials.push({
      id: t.id,
      label: t.label,
      status: t.status,
      views: t.views,
      likes: t.likes,
      shares: t.shares,
      winner: t.winner,
      permalink: t.permalink,
      posted_at: t.posted_at,
    });
    groups.set(t.video_id, g);
  }

  // Rank trials within each video by views; rank videos by their best trial.
  const out = [...groups.values()];
  for (const g of out) g.trials.sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
  out.sort((a, b) => (b.trials[0]?.views ?? -1) - (a.trials[0]?.views ?? -1));
  return out;
}
