"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { runPublishJob } from "@/lib/publish-runner";
import { isCarouselFormat } from "@/lib/taxonomy";
import { releaseFromVa } from "@/lib/va-handoff";
import type { TrialPost } from "@/lib/types";

// ---------------------------------------------------------------------------
// Trial reels — the manager surface (RLS-scoped; see migration 028).
//
// A trial is one hook variant posted as an Instagram TRIAL reel. Meta's API
// can neither post nor read trials, so these rows track manual work: the VA
// posts from the app (see posting-actions.ts — the VA's service-role
// surface), someone types the numbers in from IG's own insights screen, the
// client stars a winner, and promotion hands the cut to the ordinary
// publish_jobs pipeline — from there metrics flow in by API like any post.
// ---------------------------------------------------------------------------

function revalidateTrials(videoId?: string) {
  revalidatePath("/posting");
  revalidatePath("/analytics");
  if (videoId) revalidatePath(`/videos/${videoId}`);
}

type Db = Awaited<ReturnType<typeof supabaseServer>>;

/**
 * Every cut of a video gets a row to hang its choices on — trial or main feed,
 * its caption, whether it's been sent to the VA. The rows are drafts until
 * "Send to VA": nothing here reaches the VA by existing. A carousel has no
 * cuts, so it gets the one row.
 */
async function ensureVariantRows(supabase: Db, createdBy: string, videoId: string) {
  const [{ data: video }, { data: cuts }, { data: existing }] = await Promise.all([
    supabase.from("videos").select("formats").eq("id", videoId).maybeSingle(),
    supabase.from("video_cuts").select("id, label, kind").eq("video_id", videoId).order("position"),
    supabase.from("trial_posts").select("cut_id, status").eq("video_id", videoId),
  ]);
  const live = (existing ?? []).filter((t) => t.status !== "archived");
  const rows: Record<string, unknown>[] = [];
  if (video && isCarouselFormat(video.formats as string[])) {
    if (!live.some((t) => t.cut_id === null)) {
      rows.push({ video_id: videoId, cut_id: null, label: "Carousel", status: "planned", post_as: "main", created_by: createdBy });
    }
  } else {
    const have = new Set(live.map((t) => t.cut_id as string | null));
    for (const c of cuts ?? []) {
      if (!have.has(c.id)) {
        rows.push({ video_id: videoId, cut_id: c.id, label: c.label, status: "planned", post_as: "trial", created_by: createdBy });
      }
    }
  }
  if (rows.length) await supabase.from("trial_posts").insert(rows);
}

/** Everything the workspace Trials panel needs in one load. */
export async function listVideoTrials(videoId: string): Promise<{
  trials: TrialPost[];
  cuts: { id: string; label: string; kind: string; notes: string | null }[];
}> {
  const me = await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  await ensureVariantRows(supabase, me.id, videoId);
  const [{ data: trials }, { data: cuts }] = await Promise.all([
    supabase.from("trial_posts").select("*").eq("video_id", videoId).order("created_at"),
    supabase
      .from("video_cuts")
      .select("id, label, kind, notes")
      .eq("video_id", videoId)
      .order("position"),
  ]);
  return {
    trials: (trials as TrialPost[]) ?? [],
    cuts: (cuts as { id: string; label: string; kind: string; notes: string | null }[]) ?? [],
  };
}

/**
 * Hand a video to the VA. Its stage becomes "With the VA" and every variant that
 * hasn't been posted goes onto their desk — with the destination (trial reel or
 * main feed) and the caption it has now. There is no separate "sent" state per
 * variant: the video's stage is the hand-off. Calling it again while the video
 * is already with the VA just saves the notes and cover.
 *
 * A variant nobody picked a destination for is posted as a trial (a carousel,
 * which can't be a trial, goes to the feed); one with no caption of its own uses
 * the video's shared caption.
 */
export async function sendToVaAction(input: {
  videoId: string;
  notes?: string | null;
  coverPath?: string | null;
}) {
  const me = await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { data: video } = await supabase
    .from("videos")
    .select("cover_path, status, post_caption")
    .eq("id", input.videoId)
    .single();
  if (!video) return { error: "Video not found." };
  if (video.status !== "ready_to_post" && video.status !== "with_va") {
    return { error: "Only a video in Ready to Post can be sent to the VA." };
  }
  await ensureVariantRows(supabase, me.id, input.videoId);

  const { data: rows } = await supabase.from("trial_posts").select("*").eq("video_id", input.videoId);
  const live = ((rows as TrialPost[]) ?? []).filter((t) => t.status === "planned");
  if (!live.length && !((rows as TrialPost[]) ?? []).some((t) => t.status !== "archived")) {
    return { error: "There's no cut on this video to send yet." };
  }

  const now = new Date().toISOString();
  const shared = (video.post_caption as string | null)?.trim() || null;
  const results = await Promise.all(
    live.map((t) => {
      const postAs = t.post_as === "none" ? (t.cut_id === null ? "main" : "trial") : t.post_as;
      return supabase
        .from("trial_posts")
        .update({ post_as: postAs, caption: t.caption?.trim() || shared, sent_to_va_at: t.sent_to_va_at ?? now })
        .eq("id", t.id);
    })
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message };

  const { error: vErr } = await supabase
    .from("videos")
    .update({
      status: "with_va",
      va_notes: input.notes === undefined ? undefined : input.notes?.trim() || null,
      cover_path: input.coverPath ?? video.cover_path ?? null,
      va_sent_at: now,
    })
    .eq("id", input.videoId);
  if (vErr) return { error: vErr.message };

  revalidateTrials(input.videoId);
  revalidatePath("/board");
  return { ok: true as const, queued: live.length };
}

/** Save the instructions for the VA while the video is with them — they see the change straight away. */
export async function saveVaNotesAction(videoId: string, notes: string) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { error } = await supabase.from("videos").update({ va_notes: notes.trim() || null }).eq("id", videoId);
  if (error) return { error: error.message };
  revalidatePath("/posting");
  return { ok: true as const };
}

/** Set the cover the VA posts with (an image already uploaded to the footage bucket). */
export async function saveVaCoverAction(videoId: string, coverPath: string) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { error } = await supabase.from("videos").update({ cover_path: coverPath }).eq("id", videoId);
  if (error) return { error: error.message };
  revalidatePath("/posting");
  revalidatePath(`/videos/${videoId}`);
  return { ok: true as const };
}

/** What the board's "send to the VA" dialog needs for one video — its details and its variants, in one round trip. */
export async function getVaHandoffInfoAction(videoId: string) {
  const me = await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  await ensureVariantRows(supabase, me.id, videoId);
  const [{ data: v }, { data: trials }, { data: cuts }] = await Promise.all([
    supabase.from("videos").select("title, status, va_notes, cover_path, post_caption").eq("id", videoId).maybeSingle(),
    supabase.from("trial_posts").select("*").eq("video_id", videoId).order("created_at"),
    supabase.from("video_cuts").select("id, label, kind, notes").eq("video_id", videoId).order("position"),
  ]);
  if (!v) return null;
  return {
    title: v.title as string,
    status: v.status as string,
    notes: (v.va_notes as string | null) ?? "",
    hasCover: Boolean(v.cover_path),
    postCaption: (v.post_caption as string | null) ?? "",
    trials: ((trials as TrialPost[]) ?? []).filter((t) => t.status !== "archived"),
    cuts: (cuts as { id: string; label: string; kind: string; notes: string | null }[]) ?? [],
  };
}

/** Change a variant's destination (trial reel or main feed) or its caption — always allowed, even while it's with the VA. */
export async function updateVariantAction(
  id: string,
  videoId: string,
  patch: { postAs?: "trial" | "main" | "none"; caption?: string | null; notes?: string | null; coverPath?: string | null }
) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const clean: Record<string, unknown> = {};
  if (patch.postAs) clean.post_as = patch.postAs;
  if ("caption" in patch) clean.caption = patch.caption?.trim() || null;
  if ("notes" in patch) clean.notes = patch.notes?.trim() || null;
  if ("coverPath" in patch) clean.cover_path = patch.coverPath || null;
  if (Object.keys(clean).length === 0) return { ok: true as const };
  const { error } = await supabase.from("trial_posts").update(clean).eq("id", id);
  if (error) return { error: error.message };
  revalidateTrials(videoId);
  return { ok: true as const };
}

export async function queueTrialAction(input: {
  videoId: string;
  cutId: string | null;
  label: string;
  caption?: string | null;
  scheduledFor?: string | null;
}) {
  const me = await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { error } = await supabase.from("trial_posts").insert({
    video_id: input.videoId,
    cut_id: input.cutId,
    label: input.label.trim() || "Variant",
    caption: input.caption?.trim() || null,
    scheduled_for: input.scheduledFor ? new Date(input.scheduledFor).toISOString() : null,
    status: "planned",
    created_by: me.id,
  });
  if (error) return { error: error.message };
  revalidateTrials(input.videoId);
  return { ok: true };
}

/**
 * One click after the variants land: every hook cut that doesn't already have
 * a live or planned trial gets queued for the VA. The caption defaults to the
 * video's script body + CTA — same default the Post tab starts from.
 */
export async function queueAllVariantsAction(videoId: string) {
  const me = await requireRole("owner", "admin");
  const supabase = await supabaseServer();

  const [{ data: video }, { data: cuts }, { data: existing }] = await Promise.all([
    supabase.from("videos").select("script_body, script_cta").eq("id", videoId).single(),
    supabase.from("video_cuts").select("id, label").eq("video_id", videoId).eq("kind", "hook").order("position"),
    supabase.from("trial_posts").select("cut_id, status").eq("video_id", videoId),
  ]);
  const busy = new Set(
    (existing ?? []).filter((t) => t.status !== "archived").map((t) => t.cut_id as string)
  );
  const todo = (cuts ?? []).filter((c) => !busy.has(c.id));
  if (todo.length === 0) return { error: "Every hook variant already has a trial queued." };

  const caption =
    [video?.script_body, video?.script_cta].filter(Boolean).join("\n\n").trim() || null;
  const { error } = await supabase.from("trial_posts").insert(
    todo.map((c) => ({
      video_id: videoId,
      cut_id: c.id,
      label: c.label,
      caption,
      status: "planned",
      created_by: me.id,
    }))
  );
  if (error) return { error: error.message };
  revalidateTrials(videoId);
  return { ok: true, queued: todo.length };
}

export async function updateTrialAction(
  id: string,
  videoId: string,
  patch: { caption?: string | null; scheduled_for?: string | null; notes?: string | null }
) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const clean: Record<string, unknown> = {};
  if ("caption" in patch) clean.caption = patch.caption?.trim() || null;
  if ("scheduled_for" in patch)
    clean.scheduled_for = patch.scheduled_for ? new Date(patch.scheduled_for).toISOString() : null;
  if ("notes" in patch) clean.notes = patch.notes?.trim() || null;
  if (Object.keys(clean).length === 0) return { ok: true };
  const { error } = await supabase.from("trial_posts").update(clean).eq("id", id);
  if (error) return { error: error.message };
  revalidateTrials(videoId);
  return { ok: true };
}

export async function markTrialPostedAction(id: string, videoId: string, permalink: string) {
  const me = await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("trial_posts")
    .update({
      status: "posted",
      posted_at: new Date().toISOString(),
      posted_by: me.id,
      permalink: permalink.trim() || null,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateTrials(videoId);
  return { ok: true };
}

/** Numbers read off the IG app's trial insights — the only place they exist. */
export async function saveTrialMetricsAction(
  id: string,
  videoId: string,
  m: { views?: number | null; likes?: number | null; comments?: number | null; shares?: number | null; saves?: number | null }
) {
  const me = await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const num = (v: number | null | undefined) =>
    v === null || v === undefined || Number.isNaN(v) ? null : Math.max(0, Math.round(v));
  const { error } = await supabase
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
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateTrials(videoId);
  return { ok: true };
}

/**
 * Star the winning hook. One winner per video (partial unique index), so the
 * previous star is cleared first — starring is a decision, not an accumulation.
 */
export async function markTrialWinnerAction(id: string, videoId: string) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { error: clearErr } = await supabase
    .from("trial_posts")
    .update({ winner: false })
    .eq("video_id", videoId)
    .eq("winner", true);
  if (clearErr) return { error: clearErr.message };
  const { error } = await supabase.from("trial_posts").update({ winner: true }).eq("id", id);
  if (error) return { error: error.message };
  revalidateTrials(videoId);
  return { ok: true };
}

export async function archiveTrialAction(id: string, videoId: string) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { error } = await supabase.from("trial_posts").update({ status: "archived" }).eq("id", id);
  if (error) return { error: error.message };
  revalidateTrials(videoId);
  return { ok: true };
}

/**
 * Promote a winning trial to the main feed: a publish_job for that exact cut,
 * through the same machinery every scheduled post uses — so once it's live,
 * video_metrics picks it up from the Graph API like any other post.
 *
 * With a time → scheduled (cron / Publish now runs it). Without → published
 * immediately, awaiting the same container-poll `publishNowAction` awaits.
 */
export async function promoteTrialAction(id: string, videoId: string, whenISO?: string | null) {
  const me = await requireRole("owner", "admin");
  const supabase = await supabaseServer();

  const { data: trial } = await supabase.from("trial_posts").select("*").eq("id", id).single();
  if (!trial) return { error: "Trial not found." };
  if (!trial.cut_id) return { error: "This trial isn't linked to a cut, so there's nothing to publish." };

  const { data: job, error } = await supabase
    .from("publish_jobs")
    .insert({
      video_id: videoId,
      cut_id: trial.cut_id,
      caption: trial.caption ?? null,
      scheduled_for: whenISO ? new Date(whenISO).toISOString() : new Date().toISOString(),
      status: "scheduled",
      created_by: me.id,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  const { error: linkErr } = await supabase
    .from("trial_posts")
    .update({ status: "promoted", promoted_job_id: job.id })
    .eq("id", id);
  if (linkErr) return { error: linkErr.message };

  revalidateTrials(videoId);
  revalidatePath("/publishing");

  if (!whenISO) {
    const res = await runPublishJob(job.id);
    if (!res.ok) return { error: `Queued, but publishing failed: ${res.error}` };
  }
  return { ok: true };
}

/** Save the video's shared caption, so it survives a refresh and reaches the VA's desk. */
export async function savePostCaptionAction(videoId: string, caption: string) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("videos")
    .update({ post_caption: caption.trim() ? caption : null })
    .eq("id", videoId);
  if (error) return { error: error.message };
  revalidatePath("/posting");
  return { ok: true as const };
}

/**
 * Take the video back from the VA: it returns to Ready to Post, everything
 * unposted leaves their desk (captions and destinations are kept) and anything
 * scheduled comes off the schedule.
 */
export async function takeBackFromVaAction(videoId: string) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  await releaseFromVa(videoId);
  const { error } = await supabase.from("videos").update({ status: "ready_to_post" }).eq("id", videoId).eq("status", "with_va");
  if (error) return { error: error.message };
  revalidateTrials(videoId);
  revalidatePath("/board");
  return { ok: true as const };
}

/** The latest ready version of a cut, for watching it without leaving the page. */
export async function getCutPlaybackAction(cutId: string) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { data: v } = await supabase
    .from("cut_versions")
    .select("playback_url, thumbnail_url, version, status")
    .eq("cut_id", cutId)
    .eq("status", "ready")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!v?.playback_url) return null;
  return { playbackUrl: v.playback_url as string, poster: (v.thumbnail_url as string | null) ?? null, version: v.version as number };
}
