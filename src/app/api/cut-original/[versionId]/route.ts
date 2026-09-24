import { getCurrentProfile } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ORIGINAL_COLUMNS, originalResponse } from "@/lib/cut-files";

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
    .select(ORIGINAL_COLUMNS)
    .eq("id", versionId)
    .maybeSingle();
  if (!v) return new Response("Not found.", { status: 404 });
  return originalResponse(v as never);
}
