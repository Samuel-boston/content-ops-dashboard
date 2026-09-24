import { getCurrentProfile } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { driveFileIdFromLink, openDriveFile } from "@/lib/integrations/drive";

// Big source files stream through here; give them time.
export const maxDuration = 300;

/**
 * Download a raw-footage file that lives in Google Drive.
 *
 * Raw footage is moved into the client's Drive after upload, and the editors
 * have no access to that Drive — so a plain Drive link is a dead end for them.
 * This checks they're signed in and allowed to see the video the file belongs
 * to (the same row-level rules as everywhere else), then streams the file
 * through the dashboard's own Drive login.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentProfile();
  if (!me || !me.active) return new Response("Sign in first.", { status: 401 });

  // RLS does the access check: an asset on a video this person can't see is not returned.
  const supabase = await supabaseServer();
  const { data: asset } = await supabase
    .from("video_assets")
    .select("label, storage_path, drive_url, external_url")
    .eq("id", id)
    .maybeSingle();
  if (!asset) return new Response("Not found.", { status: 404 });

  // Still in Storage (Drive isn't connected, or hasn't mirrored it yet): a short-lived link.
  if (asset.storage_path && !asset.drive_url) {
    const { data: signed } = await supabase.storage
      .from("footage")
      .createSignedUrl(asset.storage_path as string, 600, { download: (asset.label as string) || true });
    if (signed?.signedUrl) return Response.redirect(signed.signedUrl, 302);
  }
  if (!asset.drive_url) {
    return asset.external_url
      ? Response.redirect(asset.external_url as string, 302)
      : new Response("No file for this one.", { status: 404 });
  }

  const fileId = driveFileIdFromLink(asset.drive_url as string);
  if (!fileId) return new Response("That Drive link isn't a file.", { status: 422 });

  let upstream: Response;
  try {
    upstream = await openDriveFile(fileId);
  } catch (e) {
    return new Response((e as Error).message, { status: 503 });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response(`Drive said no (${upstream.status}).`, { status: 502 });
  }

  const name = ((asset.label as string) || "footage").replace(/[\r\n"\\]/g, "_");
  const headers = new Headers({
    "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
    "content-disposition": `attachment; filename="${name}"`,
    "cache-control": "private, no-store",
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("content-length", length);
  return new Response(upstream.body, { headers });
}
