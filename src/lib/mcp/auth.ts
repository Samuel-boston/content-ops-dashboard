import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";

const TOKEN_PREFIX = "cod_";

/** A fresh, unguessable token. Shown to the user exactly once. */
export function generateToken(): string {
  return TOKEN_PREFIX + randomBytes(24).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Resolves a bearer token from an /api/mcp request to the profile that owns
 * it. Uses the service-role client — this endpoint has no browser session,
 * so this lookup (plus per-tool checks in lib/mcp/tools.ts) is the entire
 * access-control boundary for the MCP surface.
 */
export async function resolveMcpUser(bearerToken: string | null): Promise<Profile | null> {
  if (!bearerToken || !bearerToken.startsWith(TOKEN_PREFIX)) return null;
  const db = supabaseAdmin();
  const hash = hashToken(bearerToken);
  const { data: tok } = await db
    .from("personal_access_tokens")
    .select("id, user_id, revoked_at")
    .eq("token_hash", hash)
    .is("revoked_at", null)
    .maybeSingle();
  if (!tok) return null;

  const { data: profile } = await db
    .from("profiles")
    .select("*")
    .eq("id", tok.user_id)
    .eq("active", true)
    .maybeSingle();
  if (!profile) return null;

  await db
    .from("personal_access_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", tok.id);

  return profile as Profile;
}
