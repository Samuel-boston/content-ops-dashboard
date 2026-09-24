"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import {
  containerReady,
  createCarouselContainer,
  createReelContainer,
  publishContainer,
} from "@/lib/integrations/instagram";
import { getDownloadUrl } from "@/lib/integrations/stream";
import { markVideoPosted } from "@/lib/archive";
import type { PublishJob } from "@/lib/types";

export async function listPublishJobs(): Promise<PublishJob[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("publish_jobs")
    .select("*")
    .order("scheduled_for", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  return (data as PublishJob[]) ?? [];
}

export async function createPublishJobAction(formData: FormData) {
  const me = await requireRole("owner", "admin");
  const videoId = String(formData.get("video_id") || "");
  const caption = String(formData.get("caption") || "").trim();
  const when = String(formData.get("scheduled_for") || "").trim();
  if (!videoId) return { error: "Pick a video." };

  const supabase = await supabaseServer();
  const { data: cut } = await supabase
    .from("video_cuts")
    .select("id")
    .eq("video_id", videoId)
    .eq("kind", "main")
    .maybeSingle();

  const { error } = await supabase.from("publish_jobs").insert({
    video_id: videoId,
    cut_id: cut?.id ?? null,
    caption: caption || null,
    scheduled_for: when ? new Date(when).toISOString() : null,
    status: "scheduled",
    created_by: me.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/publishing");
  return { ok: true };
}

/**
 * The workspace Post tab's scheduler. Same table as the Publishing board, but
 * scoped to one cut and able to target several channels.
 *
 * Only Instagram has a working publish path (Graph API); the other channels are
 * recorded on the job so the calendar and the client both know the intent, and
 * the Publishing board marks them as needing a manual post. Nothing here
 * pretends to publish to a network we can't actually reach.
 */
export async function schedulePostAction(input: {
  videoId: string;
  cutId: string | null;
  caption: string;
  channels: string[];
  scheduledFor: string | null;
  coverOffsetMs?: number;
  shareToFeed?: boolean;
}) {
  const me = await requireRole("owner", "admin");
  if (!input.channels.length) return { error: "Pick at least one channel." };

  const supabase = await supabaseServer();
  const { error } = await supabase.from("publish_jobs").insert({
    video_id: input.videoId,
    cut_id: input.cutId,
    caption: input.caption.trim() || null,
    channels: input.channels,
    scheduled_for: input.scheduledFor ? new Date(input.scheduledFor).toISOString() : null,
    cover_offset_ms: Math.max(0, Math.round(input.coverOffsetMs ?? 0)),
    share_to_feed: input.shareToFeed ?? true,
    status: "scheduled",
    created_by: me.id,
  });
  if (error) return { error: error.message };

  revalidatePath("/publishing");
  revalidatePath("/calendar");
  revalidatePath(`/videos/${input.videoId}`);
  return { ok: true };
}

export async function listVideoPublishJobs(videoId: string): Promise<PublishJob[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("publish_jobs")
    .select("*")
    .eq("video_id", videoId)
    .order("created_at", { ascending: false });
  return (data as PublishJob[]) ?? [];
}

export async function cancelPublishJobAction(id: string) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  await supabase.from("publish_jobs").update({ status: "cancelled" }).eq("id", id);
  revalidatePath("/publishing");
  return { ok: true };
}

/**
 * Run one publish job now: pull the cut's MP4 from Stream, create + poll an IG
 * Reel container, publish it, and record the media id + attach metrics. Also
 * called by the cron route for due scheduled jobs.
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
        .select("stream_uid, drive_file_url")
        .eq("cut_id", job.cut_id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      let videoUrl = top?.drive_file_url ?? null;
      if (!videoUrl && top?.stream_uid) videoUrl = await getDownloadUrl(top.stream_uid);
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
      try {
        creationId = await createCarouselContainer(urls, job.caption ?? "");
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
    return { ok: false, error: (e as Error).message };
  }
}

export async function publishNowAction(id: string) {
  await requireRole("owner", "admin");
  const res = await runPublishJob(id);
  revalidatePath("/publishing");
  return res.ok ? { ok: true } : { error: res.error };
}
