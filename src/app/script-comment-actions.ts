"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { displayName } from "@/lib/format";
import type { ScriptComment } from "@/lib/types";

// ---------------------------------------------------------------------------
// Comments on a script — the client writes them against a hook, the body, the
// call to action or a carousel slide; the copywriter reads, answers and marks
// them done. Row access is RLS-scoped (migration 035): owner, admin and
// copywriter only, and only for videos they can see.
// ---------------------------------------------------------------------------

const AUTHOR = "author:profiles!script_comments_author_id_fkey (id, full_name, email, role)";

export async function listScriptComments(videoId: string): Promise<ScriptComment[]> {
  await requireRole("owner", "admin", "copywriter");
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("script_comments")
    .select(`*, ${AUTHOR}`)
    .eq("video_id", videoId)
    .order("created_at");
  return (data as unknown as ScriptComment[]) ?? [];
}

export async function addScriptCommentAction(input: {
  videoId: string;
  target: string;
  quote?: string | null;
  body: string;
}) {
  const me = await requireRole("owner", "admin", "copywriter");
  const body = input.body.trim();
  if (!body) return { error: "Write something first." };
  const supabase = await supabaseServer();

  const { error } = await supabase.from("script_comments").insert({
    video_id: input.videoId,
    target: input.target,
    quote: input.quote?.trim().slice(0, 500) || null,
    body,
    author_id: me.id,
  });
  if (error) return { error: error.message };

  // Tell the other side. The client commenting pings the copywriter(s); a
  // copywriter replying pings the client — the one thing this exists to fix
  // is notes that nobody knows were left.
  const { data: v } = await supabase.from("videos").select("title").eq("id", input.videoId).maybeSingle();
  const { data: others } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("active", true)
    .in("role", me.role === "copywriter" ? ["owner", "admin"] : ["copywriter"]);
  await notify({
    userIds: (others ?? []).map((p) => p.id as string).filter((id) => id !== me.id),
    kind: "system",
    title: `${displayName(me)} left a note on the script for “${v?.title ?? "a video"}”`,
    body: body.slice(0, 200),
    link: `/videos/${input.videoId}/script`,
    videoId: input.videoId,
  });

  revalidatePath(`/videos/${input.videoId}/script`);
  return { ok: true as const };
}

export async function resolveScriptCommentAction(id: string, videoId: string, resolved: boolean) {
  const me = await requireRole("owner", "admin", "copywriter");
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("script_comments")
    .update({ resolved, resolved_by: resolved ? me.id : null })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/videos/${videoId}/script`);
  return { ok: true as const };
}

export async function deleteScriptCommentAction(id: string, videoId: string) {
  await requireRole("owner", "admin", "copywriter");
  const supabase = await supabaseServer();
  const { error } = await supabase.from("script_comments").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/videos/${videoId}/script`);
  return { ok: true as const };
}
