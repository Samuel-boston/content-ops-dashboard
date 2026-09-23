"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { getDownloadUrl } from "@/lib/integrations/stream";
import type { PublishStatus, TrialPost, TrialStatus } from "@/lib/types";

// ---------------------------------------------------------------------------
// The VA's posting surface.
//
// A VA has NO row access under RLS — deliberately. Their whole job is "post
// what's queued, paste the link back, type the numbers in", and this file is
// that job and nothing else: service-role reads that hand-pick fields, the
// same pattern the MCP tools and guest links already use. Titles and captions
// reach them; scripts, budgets, analytics and settings never do. Every write
// is limited to the trial columns a poster legitimately owns.
//
// Managers pass the same gates so they can see exactly what the VA sees.
// ---------------------------------------------------------------------------

export interface PostingTrialItem {
  id: string;
  videoId: string;
  videoTitle: string;
  label: string;
  caption: string | null;
  /** Instagram trial reel, or straight to the main feed. */
  postAs: "trial" | "main";
  /** Instructions from whoever sent it over. */
  notes: string | null;
  /** Signed link to the cover image, when one was uploaded. */
  coverUrl: string | null;
  status: TrialStatus;
  scheduled_for: string | null;
  posted_at: string | null;
  permalink: string | null;
  winner: boolean;
  hasMetrics: boolean;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

export interface PostingJobItem {
  id: string;
  videoTitle: string;
  caption: string | null;
  scheduled_for: string | null;
  status: PublishStatus;
  channels: string[];
  error: string | null;
}

/**
 * Everything on the posting desk: trials to post by hand (planned), live
 * trials awaiting their numbers (posted), and — for context — the automatic
 * publish queue, so the VA never double-posts something the API will handle.
 */
export async function listPostingWork(): Promise<{
  trials: PostingTrialItem[];
  jobs: PostingJobItem[];
}> {
  await requireRole("va", "owner", "admin");
  const db = supabaseAdmin();

  const [{ data: trials }, { data: jobs }] = await Promise.all([
    db
      .from("trial_posts")
      .select("*, video:videos (title, va_notes, cover_path)")
      .in("status", ["planned", "posted"])
      .order("scheduled_for", { ascending: true, nullsFirst: false }),
    db
      .from("publish_jobs")
      .select("id, caption, scheduled_for, status, channels, error, video:videos (title)")
      .in("status", ["scheduled", "publishing", "failed"])
      .order("scheduled_for", { ascending: true, nullsFirst: false })
      .limit(30),
  ]);

  return {
    trials: await Promise.all(((trials as (TrialPost & {
      video: { title: string; va_notes: string | null; cover_path: string | null } | null;
    })[]) ?? []).map(async (t) => {
      let coverUrl: string | null = null;
      if (t.video?.cover_path) {
        const { data: signed } = await db.storage.from("footage").createSignedUrl(t.video.cover_path, 3600);
        coverUrl = signed?.signedUrl ?? null;
      }
      return {
      id: t.id,
      videoId: t.video_id,
      videoTitle: t.video?.title ?? "Untitled",
      label: t.label,
      caption: t.caption,
      postAs: t.post_as ?? "trial",
      notes: t.notes ?? t.video?.va_notes ?? null,
      coverUrl,
      status: t.status,
      scheduled_for: t.scheduled_for,
      posted_at: t.posted_at,
      permalink: t.permalink,
      winner: t.winner,
      hasMetrics: t.views !== null || t.likes !== null,
      views: t.views,
      likes: t.likes,
      comments: t.comments,
      shares: t.shares,
      saves: t.saves,
      };
    })),
    jobs: (
      (jobs as unknown as {
        id: string;
        caption: string | null;
        scheduled_for: string | null;
        status: PublishStatus;
        channels: string[];
        error: string | null;
        video: { title: string } | null;
      }[]) ?? []
    ).map((j) => ({
      id: j.id,
      videoTitle: j.video?.title ?? "Untitled",
      caption: j.caption,
      scheduled_for: j.scheduled_for,
      status: j.status,
      channels: j.channels ?? ["instagram"],
      error: j.error,
    })),
  };
}

/**
 * The posting kit for one trial: a fresh download link for the exact cut to
 * upload, plus the caption to paste. Minted at click time — download URLs are
 * short-lived by design.
 */
export async function trialPostingKitAction(trialId: string): Promise<
  { ok: true; downloadUrl: string | null; caption: string | null; label: string } | { error: string }
> {
  await requireRole("va", "owner", "admin");
  const db = supabaseAdmin();

  const { data: trial } = await db
    .from("trial_posts")
    .select("cut_id, caption, label")
    .eq("id", trialId)
    .maybeSingle();
  if (!trial) return { error: "Trial not found." };

  let downloadUrl: string | null = null;
  if (trial.cut_id) {
    // Same resolution runPublishJob uses: newest version, Drive copy first,
    // Stream download as fallback.
    const { data: top } = await db
      .from("cut_versions")
      .select("stream_uid, drive_file_url")
      .eq("cut_id", trial.cut_id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    downloadUrl = top?.drive_file_url ?? null;
    if (!downloadUrl && top?.stream_uid) {
      try {
        downloadUrl = await getDownloadUrl(top.stream_uid);
      } catch {
        downloadUrl = null;
      }
    }
  }
  return { ok: true, downloadUrl, caption: trial.caption, label: trial.label };
}

/** The VA closes the loop: it's live, here's the link. */
export async function vaMarkTrialPostedAction(trialId: string, permalink: string) {
  const me = await requireRole("va", "owner", "admin");
  const db = supabaseAdmin();
  const { error } = await db
    .from("trial_posts")
    .update({
      status: "posted",
      posted_at: new Date().toISOString(),
      posted_by: me.id,
      permalink: permalink.trim() || null,
    })
    .eq("id", trialId)
    .eq("status", "planned");
  if (error) return { error: error.message };
  revalidatePath("/posting");
  return { ok: true };
}

/** Trial numbers, typed in from the IG app's insights screen. */
export async function vaSaveTrialMetricsAction(
  trialId: string,
  m: { views?: number | null; likes?: number | null; comments?: number | null; shares?: number | null; saves?: number | null }
) {
  const me = await requireRole("va", "owner", "admin");
  const db = supabaseAdmin();
  const num = (v: number | null | undefined) =>
    v === null || v === undefined || Number.isNaN(v) ? null : Math.max(0, Math.round(v));
  const { error } = await db
    .from("trial_posts")
    .update({
      views: num(m.views),
      likes: num(m.likes),
      comments: num(m.comments),
      shares: num(m.shares),
      saves: num(m.saves),
      metrics_updated_at: new Date().toISOString(),
      metrics_updated_by: me.id,
    })
    .eq("id", trialId);
  if (error) return { error: error.message };
  revalidatePath("/posting");
  revalidatePath("/analytics");
  return { ok: true };
}

/** The VA (or a manager) flips a variant between trial reel and main feed. */
export async function vaSetPostAsAction(trialId: string, postAs: "trial" | "main") {
  await requireRole("va", "owner", "admin");
  if (postAs !== "trial" && postAs !== "main") return { error: "Pick trial or main feed." };
  const { error } = await supabaseAdmin()
    .from("trial_posts")
    .update({ post_as: postAs })
    .eq("id", trialId)
    .eq("status", "planned");
  if (error) return { error: error.message };
  revalidatePath("/posting");
  return { ok: true };
}
