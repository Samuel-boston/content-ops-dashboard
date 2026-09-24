import { getCurrentProfile } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ORIGINAL_COLUMNS, hasOriginal, originalResponse } from "@/lib/cut-files";
import { getDownloadUrl } from "@/lib/integrations/stream";

export const maxDuration = 300;

/**
 * Download a cut's original file (not Stream's re-encoded copy), for someone
 * who's signed in. The VA has no row access by design, so managers and the VA
 * are checked by role; everyone else by the same row-level rules as the video.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await ctx.params;
  const me = await getCurrentProfile();
  if (!me || !me.active) return new Response("Sign in first.", { status: 401 });

  const privileged = me.role === "owner" || me.role === "admin" || me.role === "va";
  const db = privileged ? supabaseAdmin() : await supabaseServer();
  const { data: v } = await db
    .from("cut_versions")
    .select(`stream_uid, ${ORIGINAL_COLUMNS}`)
    .eq("id", versionId)
    .maybeSingle();
  if (!v) return new Response("Not found.", { status: 404 });
  if (hasOriginal(v as never)) return originalResponse(v as never);

  // Versions uploaded before originals were kept: Stream's copy is all there is.
  if (v.stream_uid) {
    const dl = await getDownloadUrl(v.stream_uid as string).catch(() => null);
    if (dl) return Response.redirect(dl, 302);
  }
  return new Response("No downloadable file for this version yet.", { status: 404 });
}
