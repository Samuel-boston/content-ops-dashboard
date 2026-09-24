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
    const { uploadFromUrl, moveDriveFile, driveFileIdFromLink } = await import("@/lib/integrations/drive");
    const { getDownloadUrl, deleteStreamVideo } = await import("@/lib/integrations/stream");
    const { videoFolder, syncVideoFolder } = await import("@/lib/drive-layout");
    const db = supabaseAdmin();
    const { data: video } = await db.from("videos").select("title").eq("id", videoId).single();
    const { data: cuts } = await db.from("video_cuts").select("id, label").eq("video_id", videoId);

    // Everything for this video lives in one folder: <month>/<title>/.
    const folder = await videoFolder(videoId);
    const finishedId = (cuts ?? []).length ? await folder.sub("Finished video") : null;

    let firstLink: string | null = null;
    for (const cut of cuts ?? []) {
      const { data: top } = await db
        .from("cut_versions")
        .select("id, stream_uid, version, original_path, original_drive_url, original_name")
        .eq("cut_id", cut.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!top || !finishedId) continue;

      // The archive should be the file that was uploaded, not Stream's smaller
      // re-encode of it. Original already in Drive: move it into the folder.
      // Still in Storage: copy it across. Only versions uploaded before
      // originals were kept fall back to Stream's download.
      const niceName = `${cut.label} v${top.version} — ${top.original_name ?? `${video?.title ?? "video"}.mp4`}`;
      let link: string | null = top.original_drive_url ?? null;
      if (link) {
        const fileId = driveFileIdFromLink(link);
        if (fileId) await moveDriveFile(folder.token, fileId, finishedId);
      } else if (top.original_path) {
        const { data: signed } = await db.storage.from("footage").createSignedUrl(top.original_path, 900);
        if (signed?.signedUrl) {
          link = await uploadFromUrl(signed.signedUrl, niceName, finishedId);
          await db.from("cut_versions").update({ original_drive_url: link, original_path: null }).eq("id", top.id);
          await db.storage.from("footage").remove([top.original_path]);
        }
      }
      if (!link && top.stream_uid) {
        const dl = await getDownloadUrl(top.stream_uid);
        if (dl) link = await uploadFromUrl(dl, niceName, finishedId);
      }
      if (!link) continue;
      firstLink ??= link;
      await db.from("cut_versions").update({ drive_file_url: link }).eq("id", top.id);
      if (top.stream_uid) await deleteStreamVideo(top.stream_uid);
    }

    // Script, caption, cover, info, raw footage, carousel slides.
    const folderLink = await syncVideoFolder(videoId);
    await db
      .from("videos")
      .update({ drive_folder_url: folderLink, ...(firstLink ? { drive_file_url: firstLink } : {}) })
      .eq("id", videoId);
  } catch {
    /* Drive not configured, or transient failure — leave the files where they are. */
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
