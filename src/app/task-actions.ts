"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { purgeOldDoneTasks } from "@/lib/task-purge";
import type { Priority } from "@/lib/types";

// ---------------------------------------------------------------------------
// The VA's "Other" task board.
//
// Same shape as posting-actions.ts: a VA has no row access under RLS, so this
// is served with the service role behind an explicit role gate. The VA can
// read tasks and tick them off; only a manager can write or delete them.
// ---------------------------------------------------------------------------

export interface VaTask {
  id: string;
  title: string;
  details: string | null;
  link: string | null;
  priority: Priority;
  due_date: string | null;
  status: "todo" | "done";
  done_at: string | null;
  created_at: string;
}

export async function listVaTasks(): Promise<VaTask[]> {
  await requireRole("va", "owner", "admin");
  // Anything finished more than 48 hours ago goes now — so nobody has to clear the Done column.
  await purgeOldDoneTasks();
  const { data } = await supabaseAdmin()
    .from("va_tasks")
    .select("id, title, details, link, priority, due_date, status, done_at, created_at")
    .order("created_at", { ascending: false })
    .limit(300);
  return (data as VaTask[]) ?? [];
}

interface TaskInput {
  title: string;
  details?: string | null;
  link?: string | null;
  priority: Priority;
  due_date?: string | null;
}

function clean(input: TaskInput) {
  const link = input.link?.trim() || null;
  return {
    title: input.title.trim(),
    details: input.details?.trim() || null,
    link,
    priority: input.priority,
    due_date: input.due_date || null,
  };
}

function validate(input: TaskInput): string | null {
  if (!input.title.trim()) return "Give the task a title.";
  if (input.link?.trim() && !/^https?:\/\//i.test(input.link.trim())) {
    return "The link needs to start with https://";
  }
  return null;
}

export async function createVaTaskAction(input: TaskInput) {
  const me = await requireRole("owner", "admin");
  const problem = validate(input);
  if (problem) return { error: problem };
  const { error } = await supabaseAdmin()
    .from("va_tasks")
    .insert({ ...clean(input), created_by: me.id });
  if (error) return { error: error.message };
  revalidatePath("/tasks");
  return { ok: true as const };
}

export async function updateVaTaskAction(id: string, input: TaskInput) {
  await requireRole("owner", "admin");
  const problem = validate(input);
  if (problem) return { error: problem };
  const { error } = await supabaseAdmin().from("va_tasks").update(clean(input)).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/tasks");
  return { ok: true as const };
}

/** Tick a task off, or put it back. The VA's only write. */
export async function setVaTaskDoneAction(id: string, done: boolean) {
  const me = await requireRole("va", "owner", "admin");
  const { error } = await supabaseAdmin()
    .from("va_tasks")
    .update(
      done
        ? { status: "done", done_at: new Date().toISOString(), done_by: me.id }
        : { status: "todo", done_at: null, done_by: null }
    )
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/tasks");
  return { ok: true as const };
}

export async function deleteVaTaskAction(id: string) {
  await requireRole("owner", "admin");
  const { error } = await supabaseAdmin().from("va_tasks").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/tasks");
  return { ok: true as const };
}
