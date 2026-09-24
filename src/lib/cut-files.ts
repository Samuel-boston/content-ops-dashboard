import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { driveFileIdFromLink, openDriveFile, uploadFromUrl } from "@/lib/integrations/drive";
import { getWorkspaceSettings } from "@/lib/workspace";
import { videoFolder } from "@/lib/drive-layout";

/**
 * The original file of a cut version.
 *
 * Stream keeps a re-encoded copy for playback; the untouched upload is stored
 * separately (see migration 037) — in Storage at first, in Drive once it has
 * been mirrored. Everything that posts or archives a cut should use this, not
 * Stream's download.
 */
export interface OriginalRef {
  original_path: string | null;
  original_drive_url: string | null;
  original_name: string | null;
}

export const ORIGINAL_COLUMNS = "original_path, original_drive_url, original_name";

export function hasOriginal(v: Partial<OriginalRef> | null | undefined): boolean {
  return Boolean(v?.original_path || v?.original_drive_url);
}

/** Stream the original to the caller (Drive first, Storage as a redirect). */
export async function originalResponse(v: OriginalRef): Promise<Response> {
  const name = (v.original_name || "cut.mp4").replace(/[\r\n"\\]/g, "_");
  if (v.original_drive_url) {
    const fileId = driveFileIdFromLink(v.original_drive_url);
    if (!fileId) return new Response("That Drive link isn't a file.", { status: 422 });
    const upstream = await openDriveFile(fileId);
    if (!upstream.ok || !upstream.body) return new Response(`Drive said no (${upstream.status}).`, { status: 502 });
    const headers = new Headers({
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "private, no-store",
    });
    const length = upstream.headers.get("content-length");
    if (length) headers.set("content-length", length);
    return new Response(upstream.body, { headers });
  }
  if (v.original_path) {
    const { data } = await supabaseAdmin().storage.from("footage").createSignedUrl(v.original_path, 600, { download: name });
    if (data?.signedUrl) return Response.redirect(data.signedUrl, 302);
  }
  return new Response("No original saved for this version.", { status: 404 });
}

/**
 * Copy a version's original from Storage into Drive, then drop the Storage
 * copy (Drive holds it now). Best-effort: if Drive isn't connected or fails,
 * the Storage copy simply stays where it is.
 */
export async function mirrorCutOriginalToDrive(versionId: string): Promise<void> {
  try {
    const s = await getWorkspaceSettings();
    if (!s.drive_folder_id || !s.drive_service_account) return;
    const db = supabaseAdmin();
    const { data: v } = await db
      .from("cut_versions")
      .select("original_path, original_name, cut_id, version, video_cuts (label, video_id)")
      .eq("id", versionId)
      .maybeSingle();
    if (!v?.original_path) return;
    const { data: signed } = await db.storage.from("footage").createSignedUrl(v.original_path, 900);
    if (!signed?.signedUrl) return;
    // Into the video's own folder (<month>/<title>/Finished video), not the Drive root.
    const cut = v.video_cuts as unknown as { label: string; video_id: string } | null;
    let parent: string | undefined;
    if (cut?.video_id) {
      const folder = await videoFolder(cut.video_id);
      parent = await folder.sub("Finished video");
    }
    const name = `${cut?.label ? `${cut.label} v${v.version} — ` : ""}${(v.original_name as string) || "cut.mp4"}`;
    const link = await uploadFromUrl(signed.signedUrl, name, parent);
    await db.from("cut_versions").update({ original_drive_url: link, original_path: null }).eq("id", versionId);
    await db.storage.from("footage").remove([v.original_path as string]);
  } catch {
    /* Drive unavailable — the Storage copy stays as the source of truth. */
  }
}
