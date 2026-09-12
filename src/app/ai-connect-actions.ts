"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { generateToken, hashToken } from "@/lib/mcp/auth";

export interface ApiTokenRow {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

export async function listApiTokensAction(): Promise<ApiTokenRow[]> {
  const me = await requireUser();
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("personal_access_tokens")
    .select("id, label, created_at, last_used_at")
    .eq("user_id", me.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  return (data as ApiTokenRow[]) ?? [];
}

/** Returns the raw token exactly once — the server never stores or shows it again. */
export async function createApiTokenAction(label: string) {
  const me = await requireUser();
  const supabase = await supabaseServer();
  const token = generateToken();
  const { error } = await supabase.from("personal_access_tokens").insert({
    user_id: me.id,
    label: label.trim() || "AI assistant",
    token_hash: hashToken(token),
  });
  if (error) return { error: error.message };
  revalidatePath("/ai-connect");
  return { ok: true, token };
}

export async function revokeApiTokenAction(id: string) {
  const me = await requireUser();
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("personal_access_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", me.id);
  if (error) return { error: error.message };
  revalidatePath("/ai-connect");
  return { ok: true };
}
