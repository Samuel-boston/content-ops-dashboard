import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "@/lib/notify";
import { isCarouselFormat, isLongFormFormat } from "@/lib/taxonomy";
import type { VideoStatus } from "@/lib/types";

/**
 * A video is "with the VA" exactly when its status is `with_va` — nothing else
 * marks it. Leaving that stage for any reason other than being posted (the
 * client takes it back, the VA sends it back, someone drags it elsewhere) has
 * to clean up after it, or the VA's desk and the client's board disagree:
 *
 *  - anything scheduled for it comes off Instagram's schedule, so it can't
 *    publish while it's being changed;
 *  - variants that were waiting on that schedule go back to "to post";
 *  - variants ticked "posted" during the hand-off go back to "to post";
 *  - the hand-off markers are cleared (captions and destinations are kept).
 *
 * It does NOT change the video's status — the caller decides where it goes.
 */
export async function releaseFromVa(videoId: string): Promise<void> {
  const db = supabaseAdmin();
  const { data: scheduled } = await db
    .from("trial_posts")
    .select("promoted_job_id")
    .eq("video_id", videoId)
    .eq("status", "promoted")
    .is("posted_at", null);
  for (const t of scheduled ?? []) {
    if (t.promoted_job_id) {
      await db.from("publish_jobs").update({ status: "cancelled" }).eq("id", t.promoted_job_id).eq("status", "scheduled");
    }
  }
  await db
    .from("trial_posts")
    .update({ status: "planned", promoted_job_id: null })
    .eq("video_id", videoId)
    .eq("status", "promoted")
    .is("posted_at", null);
  // "Posted" ticks made during this hand-off were provisional — the video was never
  // marked posted — so they must not survive it coming back, or it would read as
  // posted while sitting in Ready to Post. (Captions and destinations are kept.)
  await db
    .from("trial_posts")
    .update({ status: "planned", posted_at: null, posted_by: null })
    .eq("video_id", videoId)
    .eq("status", "posted");
  await db.from("trial_posts").update({ sent_to_va_at: null }).eq("video_id", videoId).eq("status", "planned");
  await db.from("videos").update({ va_sent_at: null }).eq("id", videoId);
}

/**
 * Every cut of a video gets a row to hang its choices on — trial or main feed,
 * its caption, whether it's been sent to the VA. A carousel has no cuts, so it
 * gets the one row. Safe to call again: it only adds what's missing.
 */
export async function ensureVariantRows(videoId: string, createdBy: string | null): Promise<void> {
  const db = supabaseAdmin();
  const [{ data: video }, { data: cuts }, { data: existing }] = await Promise.all([
    db.from("videos").select("formats").eq("id", videoId).maybeSingle(),
    db.from("video_cuts").select("id, label, kind").eq("video_id", videoId).order("position"),
    db.from("trial_posts").select("cut_id, status").eq("video_id", videoId),
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
        // A long video goes to YouTube as a regular video: never a trial reel.
        rows.push({ video_id: videoId, cut_id: c.id, label: c.label, status: "planned", post_as: isLongFormFormat(video?.formats as string[]) ? "main" : "trial", created_by: createdBy });
      }
    }
  }
  if (rows.length) await db.from("trial_posts").insert(rows);
}

/**
 * Approval hands a video straight to the VA: make sure every variant has a
 * row, give any variant nobody picked a destination for its default (a trial
 * reel; a carousel goes to the feed), mark them sent, and tell the VAs. The
 * caller has already moved the video to `with_va`.
 */
export async function handOffToVa(videoId: string, byUserId: string | null): Promise<void> {
  const db = supabaseAdmin();
  await ensureVariantRows(videoId, byUserId);
  const now = new Date().toISOString();
  const { data: rows } = await db.from("trial_posts").select("id, cut_id, post_as, sent_to_va_at, status").eq("video_id", videoId);
  const { data: fmt } = await db.from("videos").select("formats").eq("id", videoId).maybeSingle();
  const longForm = isLongFormFormat(fmt?.formats as string[]);
  for (const t of (rows ?? []).filter((r) => r.status === "planned")) {
    const postAs = longForm ? "main" : t.post_as === "none" ? (t.cut_id === null ? "main" : "trial") : t.post_as;
    await db.from("trial_posts").update({ post_as: postAs, sent_to_va_at: t.sent_to_va_at ?? now }).eq("id", t.id);
  }
  await db.from("videos").update({ va_sent_at: now }).eq("id", videoId).is("va_sent_at", null);

  const [{ data: video }, { data: vas }] = await Promise.all([
    db.from("videos").select("title").eq("id", videoId).maybeSingle(),
    db.from("profiles").select("id").eq("role", "va").eq("active", true),
  ]);
  await notify({
    userIds: (vas ?? []).map((v) => v.id as string),
    kind: "system",
    title: `“${video?.title ?? "A video"}” is ready to post`,
    link: "/posting",
    videoId,
  });
}

/**
 * Where a video goes when it comes back off the VA's desk (the client takes it
 * back, the VA sends it back, it's parked): the review where it was approved,
 * or a carousel's creative review.
 */
export async function stageAfterVa(videoId: string): Promise<VideoStatus> {
  const db = supabaseAdmin();
  const { data } = await db.from("videos").select("formats").eq("id", videoId).maybeSingle();
  return data && isCarouselFormat(data.formats as string[]) ? "needs_creatives" : "in_review";
}
