import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Service-role client — bypasses RLS. Server-only, never import from a client
 * component. Use ONLY for genuinely privileged operations that can't be
 * expressed as the acting user: creating auth users / seats, Telegram
 * automations, cron jobs. Everything a signed-in user does should go through
 * `supabaseServer()` instead, so RLS stays the real boundary.
 */
export function supabaseAdmin() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
