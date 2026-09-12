import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import type { Profile, Role } from "@/lib/types";

/**
 * The signed-in user's profile, or null. Cached per request so pages, the
 * layout, and server actions share one lookup.
 */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await supabaseServer();

  // `getClaims()` rather than `getUser()`. This project signs tokens with
  // ES256, so the JWT is verified locally against the project's published
  // JWKS (fetched once and cached) instead of costing a round trip to the
  // auth server on every single request — measured at ~465ms, which was the
  // largest single component of a page render. Verification is no weaker:
  // it's a real signature check, and RLS remains the actual boundary.
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;

  const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
  return (data as Profile | null) ?? null;
});

export async function requireUser(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.active) redirect("/login?inactive=1");
  return profile;
}

export async function requireRole(...roles: Role[]): Promise<Profile> {
  const profile = await requireUser();
  if (!roles.includes(profile.role)) redirect("/");
  return profile;
}

export const isManager = (role: Role) => role === "owner" || role === "admin";
