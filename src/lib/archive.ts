import "server-only";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notifyTelegram } from "@/lib/notify";

/**
 * Move a posted video's files out of Cloudflare Stream and into Google Drive,
 * then point the record at Drive — keeping Stream's working set small and
 * flat forever. Best-effort; a no-op unless Drive is configured.
 */
export async function archivePostedToDrive(videoId: string) {
  try {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    const { uploadFromUrl } = await import("@/lib/integrations/drive");
    const { getDownloadUrl } = await import("@/lib/integrations/stream");
    const { deleteStreamVideo } = await import("@/lib/integrations/stream");
    const db = supabaseAdmin();
    const { data: video } = await db.from("videos").select("title").eq("id", videoId).single();
    const { data: cuts } = await db.from("video_cuts").select("id, label").eq("video_id", videoId);
    let firstLink: string | null = null;
    for (const cut of cuts ?? []) {
      const { data: top } = await db
        .from("cut_versions")
        .select("id, stream_uid, version")
        .eq("cut_id", cut.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!top?.stream_uid) continue;
      const dl = await getDownloadUrl(top.stream_uid);
      if (!dl) continue;
      const link = await uploadFromUrl(dl, `${video?.title ?? "video"} — ${cut.label} v${top.version}.mp4`);
      firstLink ??= link;
      await db.from("cut_versions").update({ drive_file_url: link }).eq("id", top.id);
      await deleteStreamVideo(top.stream_uid);
    }
    if (firstLink) await db.from("videos").update({ drive_file_url: firstLink }).eq("id", videoId);
  } catch {
    /* Drive not configured, or transient failure — leave the file in Stream. */
  }
}

/**
 * Mark a video as posted from a service-role context (the VA's posting desk,
 * the Instagram publisher) — which never goes through the client's own
 * "Mark as posted" button, so it has to do everything that button does: stamp
 * when it went out, give it a post date so it lands on the calendar, tell
 * Telegram, and start the copy to the Drive archive. Safe to call twice.
 */
export async function markVideoPosted(videoId: string): Promise<void> {
  const db = supabaseAdmin();
  const { data: v } = await db
    .from("videos")
    .select("title, status, post_date")
    .eq("id", videoId)
    .maybeSingle();
  if (!v || v.status === "posted") return;
  const now = new Date();
  await db
    .from("videos")
    .update({
      status: "posted",
      posted_at: now.toISOString(),
      post_date: v.post_date ?? now.toISOString().slice(0, 10),
    })
    .eq("id", videoId);
  after(() => archivePostedToDrive(videoId));
  await notifyTelegram(`✅ Posted: <b>${v.title}</b>`);
}
