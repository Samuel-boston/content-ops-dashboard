"use client";
import { createBrowserClient } from "@supabase/ssr";

// Reference NEXT_PUBLIC_* vars as literal member expressions so the bundler
// inlines them into the client bundle (a dynamic process.env[name] lookup is
// not inlined).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Browser Supabase client — used by the login form to sign in. */
export function supabaseBrowser() {
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. Check .env.local."
    );
  }
  return createBrowserClient(url, anonKey);
}
