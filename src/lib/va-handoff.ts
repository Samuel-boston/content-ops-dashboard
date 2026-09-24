import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * A video is "with the VA" exactly when its status is `with_va` — nothing else
 * marks it. Leaving that stage for any reason other than being posted (the
 * client takes it back, the VA sends it back, someone drags it elsewhere) has
 * to clean up after it, or the VA's desk and the client's board disagree:
 *
 *  - anything scheduled for it comes off Instagram's schedule, so it can't
 *    publish while it's being changed;
 *  - variants that were waiting on that schedule go back to "to post";
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
  await db.from("trial_posts").update({ sent_to_va_at: null }).eq("video_id", videoId).eq("status", "planned");
  await db.from("videos").update({ va_sent_at: null }).eq("id", videoId);
}
