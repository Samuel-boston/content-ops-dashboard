"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import type { AppNotification } from "@/lib/types";

export async function listMyNotifications(limit = 30): Promise<AppNotification[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as AppNotification[]) ?? [];
}

export async function unreadCount(): Promise<number> {
  const supabase = await supabaseServer();
  const { count } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("read", false);
  return count ?? 0;
}

/** Mentions specifically — what the top-nav Chat icon badges, separate from the general bell. */
export async function unreadMentionCount(): Promise<number> {
  const supabase = await supabaseServer();
  const { count } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("read", false)
    .eq("kind", "mention");
  return count ?? 0;
}

export async function markNotificationReadAction(id: string) {
  await requireUser();
  const supabase = await supabaseServer();
  await supabase.from("notifications").update({ read: true }).eq("id", id);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function markAllReadAction() {
  await requireUser();
  const supabase = await supabaseServer();
  await supabase.from("notifications").update({ read: true }).eq("read", false);
  revalidatePath("/", "layout");
  return { ok: true };
}
