import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";

/**
 * Request-scoped Supabase client authenticated as the current user (via the
 * auth cookies). All reads and user-initiated writes go through this, so
 * Postgres RLS — not the UI — is what actually scopes an editor to their own
 * queue plus the Ready to Edit pool.
 */
export async function supabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(env.publicSupabaseUrl(), env.publicSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component that can't set cookies — the proxy
          // (src/proxy.ts) refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}
