import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  containerReady,
  createCarouselContainer,
  createImageContainer,
  createReelContainer,
  publishContainer,
} from "@/lib/integrations/instagram";
import { getDownloadUrl } from "@/lib/integrations/stream";
import { markVideoPosted } from "@/lib/archive";
import { mintFileToken } from "@/lib/phone-link";
import { ORIGINAL_COLUMNS, hasOriginal } from "@/lib/cut-files";

// Deliberately NOT in a "use server" file: everything exported from one of
// those is callable from the browser as an action, and this one publishes to
// Instagram without asking who's calling. The actions that are allowed to
// trigger it (owner, admin, the VA's desk, the cron routes) each check first.

/**
 * Run one publish job now: a video goes out as a Reel (its MP4 pulled from
 * Stream), a post with no cut goes out as a carousel — or a single photo when
 * it has just one image. Creates and polls the IG container, publishes it,
 * records the media id and attaches metrics. Also called by the cron routes
 * for due scheduled jobs.
 */
export async function runPublishJob(jobId: string): Promise<{ ok: boolean; error?: string }> {
  const db = supabaseAdmin();
  const { data: job } = await db.from("publish_jobs").select("*").eq("id", jobId).single();
  if (!job || job.status === "published" || job.status === "cancelled") return { ok: true };

  await db.from("publish_jobs").update({ status: "publishing", error: null }).eq("id", jobId);
  const tempFiles: string[] = [];
  try {
    let creationId: string;
    if (job.cut_id) {
      const { data: top } = await db
        .from("cut_versions")
        .select(`id, stream_uid, drive_file_url, ${ORIGINAL_COLUMNS}`)
        .eq("cut_id", job.cut_id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      // Stream first: a Drive link is a viewer page, not a file Instagram can
      // fetch. Drive is only the fallback once Stream no longer has the video.
      let videoUrl: string | null = null;
      // The original upload, fetched by Instagram from a signed address on this
      // site — Stream's download is a re-encode and only the fallback.
      const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
      if (appUrl && top && hasOriginal(top as never)) {
        videoUrl = `${appUrl}/api/file/${mintFileToken(top.id as string, 6 * 60 * 60 * 1000)}`;
      }
      if (!videoUrl && top?.stream_uid) videoUrl = await getDownloadUrl(top.stream_uid);
      if (!videoUrl) videoUrl = top?.drive_file_url ?? null;
      if (!videoUrl) throw new Error("No downloadable video for the main cut.");

      creationId = await createReelContainer(videoUrl, job.caption ?? "", {
        thumbOffsetMs: job.cover_offset_ms ?? 0,
        shareToFeed: job.share_to_feed ?? true,
      });
    } else {
      // No cut: this is a carousel. Instagram only takes JPEG for feed images,
      // and the slides are stored as PNG — so each is converted to a temporary
      // JPEG, handed over by signed link, and cleaned up afterwards.
      const { default: sharp } = await import("sharp");
      const { data: slides } = await db
        .from("carousel_images")
        .select("storage_path")
        .eq("video_id", job.video_id)
        .not("storage_path", "is", null)
        .order("position");
      const urls: string[] = [];
      for (const sl of slides ?? []) {
        const { data: blob } = await db.storage.from("carousels").download(sl.storage_path as string);
        if (!blob) throw new Error("A slide image is missing from storage.");
        const jpeg = await sharp(Buffer.from(await blob.arrayBuffer())).jpeg({ quality: 92 }).toBuffer();
        const tmp = `_ig/${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await db.storage.from("carousels").upload(tmp, jpeg, { contentType: "image/jpeg" });
        if (upErr) throw new Error(upErr.message);
        tempFiles.push(tmp);
        const { data: signed } = await db.storage.from("carousels").createSignedUrl(tmp, 3600);
        if (!signed?.signedUrl) throw new Error("Couldn't prepare a slide for Instagram.");
        urls.push(signed.signedUrl);
      }
      if (urls.length === 0) throw new Error("This post has no images to publish.");
      try {
        creationId =
          urls.length === 1
            ? await createImageContainer(urls[0], job.caption ?? "")
            : await createCarouselContainer(urls, job.caption ?? "");
      } catch (e) {
        await db.storage.from("carousels").remove(tempFiles);
        throw e;
      }
    }
    await db.from("publish_jobs").update({ ig_creation_id: creationId }).eq("id", jobId);

    // poll up to ~2.5 min
    for (let i = 0; i < 30; i++) {
      const state = await containerReady(creationId);
      if (state === "ready") break;
      if (state === "error") throw new Error("Instagram rejected the media container.");
      await new Promise((r) => setTimeout(r, 5000));
    }

    const mediaId = await publishContainer(creationId);
    if (tempFiles.length) await db.storage.from("carousels").remove(tempFiles);
    await db
      .from("publish_jobs")
      .update({ status: "published", ig_media_id: mediaId, published_at: new Date().toISOString() })
      .eq("id", jobId);
    await db.from("video_metrics").upsert(
      { video_id: job.video_id, source: "instagram", external_media_id: mediaId },
      { onConflict: "video_id,source" }
    );
    // Published: do everything "Mark as posted" does (stamp, calendar date, archive).
    await markVideoPosted(job.video_id);
    return { ok: true };
  } catch (e) {
    if (tempFiles.length) await db.storage.from("carousels").remove(tempFiles);
    await db
      .from("publish_jobs")
      .update({ status: "failed", error: (e as Error).message })
      .eq("id", jobId);
    // A variant the VA scheduled goes back on their To-post list, so a failed
    // post isn't silently lost — the reason shows beside the failed job.
    await db
      .from("trial_posts")
      .update({ status: "planned", promoted_job_id: null })
      .eq("promoted_job_id", jobId)
      .eq("status", "promoted");
    return { ok: false, error: (e as Error).message };
  }
}


/** Every scheduled job whose time has come. Returns how many published. */
export async function runDuePublishJobs(): Promise<{ due: number; published: number; failed: number }> {
  const db = supabaseAdmin();
  const { data: due } = await db
    .from("publish_jobs")
    .select("id")
    .eq("status", "scheduled")
    .not("scheduled_for", "is", null)
    .lte("scheduled_for", new Date().toISOString());
  let published = 0;
  let failed = 0;
  for (const j of due ?? []) {
    const r = await runPublishJob(j.id);
    if (r.ok) published++;
    else failed++;
  }
  return { due: due?.length ?? 0, published, failed };
}
