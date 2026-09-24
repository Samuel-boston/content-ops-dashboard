import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getStreamVideo } from "@/lib/integrations/stream";

/**
 * Finishes uploads nobody is watching. The upload box normally polls
 * Cloudflare until a cut is ready — but that only runs while the page is open,
 * and people close it as soon as the bytes are up. This re-checks every cut
 * still marked as uploading/processing (recent ones only), so "you can close
 * the page" is true. Called by the scheduled job and whenever a video page
 * is opened.
 */
export async function syncPendingVersions(videoId?: string): Promise<number> {
  try {
    const db = supabaseAdmin();
    const since = new Date(Date.now() - 3 * 864e5).toISOString();
    let q = db
      .from("cut_versions")
      .select("id, stream_uid, cut_id")
      .in("status", ["uploading", "processing"])
      .not("stream_uid", "is", null)
      .gte("created_at", since)
      .limit(25);
    if (videoId) {
      const { data: cuts } = await db.from("video_cuts").select("id").eq("video_id", videoId);
      const ids = (cuts ?? []).map((c) => c.id as string);
      if (!ids.length) return 0;
      q = q.in("cut_id", ids);
    }
    const { data: pending } = await q;
    let updated = 0;
    for (const v of pending ?? []) {
      const state = await getStreamVideo(v.stream_uid as string);
      if (state.status === "uploading" || state.status === "processing") continue;
      await db
        .from("cut_versions")
        .update({
          status: state.status,
          duration_seconds: state.durationSeconds,
          thumbnail_url: state.thumbnailUrl,
          playback_url: state.playbackUrl,
        })
        .eq("id", v.id);
      updated += 1;
    }
    return updated;
  } catch {
    return 0;
  }
}
