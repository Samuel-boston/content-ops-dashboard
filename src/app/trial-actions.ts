"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { runPublishJob } from "@/lib/publish-runner";
import { isCarouselFormat } from "@/lib/taxonomy";
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
 * "Send this to the VA to post" — the one deliberate hand-off. Saves the
 * instructions and cover on the video, then hands over every variant that's
 * been given a destination (trial reel or main feed). A variant left on
 * "Not selected" stays behind — except the main cut, which defaults to the
 * main feed so a plain single-cut video needs no fiddling. Variants already
 * sent are left alone, so sending again after choosing another one only adds
 * that one. `fallbackCaption` fills any variant whose own caption is empty.
 */
export async function sendToVaAction(input: {
  videoId: string;
  notes?: string | null;
  coverPath?: string | null;
  fallbackCaption?: string | null;
}) {
  const me = await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  await ensureVariantRows(supabase, me.id, input.videoId);

  const [{ data: video }, { data: rows }] = await Promise.all([
    supabase.from("videos").select("cover_path, status").eq("id", input.videoId).single(),
    supabase.from("trial_posts").select("*").eq("video_id", input.videoId),
  ]);
  if (!video) return { error: "Video not found." };

  const live = ((rows as TrialPost[]) ?? []).filter((t) => t.status === "planned" && !t.sent_to_va_at);
  if (!live.length && !(rows ?? []).length) return { error: "There's no cut on this video to send yet." };

  const notes = input.notes?.trim() || null;
  const fallback = input.fallbackCaption?.trim() || null;
  const now = new Date().toISOString();
  let sent = 0;
  for (const t of live) {
    let postAs = t.post_as;
    // Nothing chosen: a carousel can only go to the feed; everything else is
    // posted as a trial first, and the best one is promoted to the main feed later.
    if (postAs === "none") postAs = t.cut_id === null ? "main" : "trial";
    const { error } = await supabase
      .from("trial_posts")
      .update({
        post_as: postAs,
        caption: t.caption?.trim() || fallback,
        notes,
        sent_to_va_at: now,
      })
      .eq("id", t.id);
    if (error) return { error: error.message };
    sent += 1;
  }

  // New notes reach variants that were already sent, too.
  await supabase
    .from("trial_posts")
    .update({ notes })
    .eq("video_id", input.videoId)
    .eq("status", "planned")
    .not("sent_to_va_at", "is", null);

  const { error: vErr } = await supabase
    .from("videos")
    .update({
      va_notes: notes,
      cover_path: input.coverPath ?? video.cover_path ?? null,
      va_sent_at: now,
      // It is now the VA's to post: its own stage on the board.
      ...(video.status === "ready_to_post" ? { status: "with_va" } : {}),
    })
    .eq("id", input.videoId);
  if (vErr) return { error: vErr.message };

  // Nothing new to hand over is fine when the video is already with the VA:
  // the notes and cover above were still updated. Only a video with no variants at all is an error.
  if (sent === 0 && !((rows ?? []) as TrialPost[]).some((t) => t.status !== "archived")) {
    return { error: "There's no cut on this video to send yet." };
  }
  revalidateTrials(input.videoId);
  return { ok: true as const, queued: sent };
}

/** Change a variant's destination ("Not selected", trial reel, main feed) or its caption. */
export async function updateVariantAction(
  id: string,
  videoId: string,
  patch: { postAs?: "trial" | "main" | "none"; caption?: string | null }
) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const clean: Record<string, unknown> = {};
  if (patch.postAs) clean.post_as = patch.postAs;
  if ("caption" in patch) clean.caption = patch.caption?.trim() || null;
  if (Object.keys(clean).length === 0) return { ok: true as const };
  const { error } = await supabase.from("trial_posts").update(clean).eq("id", id);
  if (error) return { error: error.message };
  revalidateTrials(videoId);
  return { ok: true as const };
}

/** Send just this variant to the VA — needs a destination chosen first. */
export async function sendVariantToVaAction(id: string, videoId: string, fallbackCaption?: string | null) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const [{ data: t }, { data: v }] = await Promise.all([
    supabase.from("trial_posts").select("*").eq("id", id).single(),
    supabase.from("videos").select("va_notes, status").eq("id", videoId).single(),
  ]);
  if (!t) return { error: "Variant not found." };
  const postAs = t.post_as === "none" ? (t.cut_id === null ? "main" : "trial") : t.post_as;
  const { error } = await supabase
    .from("trial_posts")
    .update({
      post_as: postAs,
      sent_to_va_at: new Date().toISOString(),
      caption: (t.caption as string | null)?.trim() || fallbackCaption?.trim() || null,
      notes: t.notes ?? v?.va_notes ?? null,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  await supabase
    .from("videos")
    .update({ va_sent_at: new Date().toISOString(), ...(v?.status === "ready_to_post" ? { status: "with_va" } : {}) })
    .eq("id", videoId);
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

/** Take a variant back off the VA's desk (e.g. to rework it). Its caption and destination are kept. */
export async function takeBackVariantAction(id: string, videoId: string) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("trial_posts")
    .update({ sent_to_va_at: null })
    .eq("id", id)
    .eq("status", "planned");
  if (error) return { error: error.message };
  await releaseIfNothingWithVa(supabase, videoId);
  revalidateTrials(videoId);
  revalidatePath("/posting");
  return { ok: true as const };
}

/** With the VA -> Ready to Post again, once nothing is left on their desk. */
async function releaseIfNothingWithVa(supabase: Db, videoId: string) {
  const { data: left } = await supabase
    .from("trial_posts")
    .select("id")
    .eq("video_id", videoId)
    .in("status", ["planned", "promoted"])
    .not("sent_to_va_at", "is", null)
    .limit(1);
  if (left?.length) return;
  await supabase.from("videos").update({ status: "ready_to_post", va_sent_at: null }).eq("id", videoId).eq("status", "with_va");
}

/**
 * Take the whole video back from the VA in one go: every unposted variant leaves
 * their desk (captions kept), anything scheduled is taken off the schedule, and
 * the video goes back to Ready to Post.
 */
export async function takeBackFromVaAction(videoId: string) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { data: scheduled } = await supabase
    .from("trial_posts")
    .select("promoted_job_id")
    .eq("video_id", videoId)
    .eq("status", "promoted")
    .is("posted_at", null);
  for (const t of scheduled ?? []) {
    if (t.promoted_job_id) {
      await supabase.from("publish_jobs").update({ status: "cancelled" }).eq("id", t.promoted_job_id).eq("status", "scheduled");
    }
  }
  await supabase
    .from("trial_posts")
    .update({ status: "planned", promoted_job_id: null })
    .eq("video_id", videoId)
    .eq("status", "promoted")
    .is("posted_at", null);
  const { error } = await supabase
    .from("trial_posts")
    .update({ sent_to_va_at: null })
    .eq("video_id", videoId)
    .eq("status", "planned");
  if (error) return { error: error.message };
  await supabase.from("videos").update({ status: "ready_to_post", va_sent_at: null }).eq("id", videoId).eq("status", "with_va");
  revalidateTrials(videoId);
  revalidatePath("/posting");
  revalidatePath("/board");
  return { ok: true as const };
}
