import { supabaseAdmin } from "@/lib/supabase/admin";
import { readFileToken } from "@/lib/phone-link";
import { ORIGINAL_COLUMNS, originalResponse } from "@/lib/cut-files";

export const maxDuration = 300;

/**
 * A cut's original file, by signed expiring link. Public by design — the token
 * is the credential — because the two callers can't log in: a phone that
 * scanned a QR code, and Instagram fetching a video to publish.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const versionId = readFileToken(token);
  if (!versionId) return new Response("This link has expired.", { status: 410 });
  const { data: v } = await supabaseAdmin()
    .from("cut_versions")
    .select(ORIGINAL_COLUMNS)
    .eq("id", versionId)
    .maybeSingle();
  if (!v) return new Response("Not found.", { status: 404 });
  return originalResponse(v as never);
}
