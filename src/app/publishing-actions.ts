"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { runPublishJob } from "@/lib/publish-runner";
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
  /** Publish immediately instead of queueing (only meaningful with no date). */
  publishNow?: boolean;
}) {
  const me = await requireRole("owner", "admin");
  if (!input.channels.length) return { error: "Pick at least one channel." };

  const supabase = await supabaseServer();
  const { data: job, error } = await supabase.from("publish_jobs").insert({
    video_id: input.videoId,
    cut_id: input.cutId,
    caption: input.caption.trim() || null,
    channels: input.channels,
    scheduled_for: input.scheduledFor ? new Date(input.scheduledFor).toISOString() : null,
    cover_offset_ms: Math.max(0, Math.round(input.coverOffsetMs ?? 0)),
    share_to_feed: input.shareToFeed ?? true,
    status: "scheduled",
    created_by: me.id,
  }).select("id").single();
  if (error) return { error: error.message };

  if (input.publishNow && !input.scheduledFor) {
    const res = await runPublishJob(job.id as string);
    revalidatePath("/publishing");
    revalidatePath("/calendar");
    revalidatePath(`/videos/${input.videoId}`);
    if (!res.ok) return { error: `Instagram didn't take it: ${res.error}` };
    return { ok: true };
  }

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

export async function publishNowAction(id: string) {
  await requireRole("owner", "admin");
  const res = await runPublishJob(id);
  revalidatePath("/publishing");
  return res.ok ? { ok: true } : { error: res.error };
}
