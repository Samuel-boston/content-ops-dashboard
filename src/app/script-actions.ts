"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { transcribeAudio } from "@/lib/integrations/whisper";
import type { HookSnippet } from "@/lib/types";

const MEDIA_BUCKET = "comment-media";
const SIGNED_URL_TTL = 60 * 60 * 6;

export async function saveScriptAction(
  videoId: string,
  script: { hooks: string[]; body: string; cta: string }
) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const hooks = script.hooks.map((h) => h.trim()).filter(Boolean);

  const { error } = await supabase
    .from("videos")
    .update({
      script_hooks: hooks,
      script_body: script.body.trim() || null,
      script_cta: script.cta.trim() || null,
      // Written = no longer waiting on a script.
      needs_script: !(hooks.length || script.body.trim()),
    })
    .eq("id", videoId);
  if (error) return { error: error.message };

  revalidatePath(`/videos/${videoId}`);
  revalidatePath(`/videos/${videoId}/script`);
  revalidatePath("/scripting");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Ideation notes. Separate from the script on purpose — an idea is allowed to
 * be messy, and none of this has to survive into what gets read to camera.
 */
export async function saveIdeaNotesAction(videoId: string, notes: string) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("videos")
    .update({ idea_notes: notes.trim() || null })
    .eq("id", videoId);
  if (error) return { error: error.message };

  revalidatePath(`/videos/${videoId}`);
  revalidatePath(`/videos/${videoId}/idea`);
  revalidatePath("/ideation");
  return { ok: true };
}

/** Attach (or clear) the client's spoken brief. */
export async function saveBriefVoiceAction(
  videoId: string,
  voice: { path: string; duration: number; peaks: number[] } | null
) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("videos")
    .update({
      brief_voice_path: voice?.path ?? null,
      brief_voice_duration_seconds: voice?.duration ?? null,
      brief_voice_peaks: voice?.peaks ?? null,
    })
    .eq("id", videoId);
  if (error) return { error: error.message };
  revalidatePath(`/videos/${videoId}`);
  revalidatePath(`/videos/${videoId}/script`);
  return { ok: true };
}

/** Signed URL for the spoken brief, minted per request. */
export async function briefVoiceUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const supabase = await supabaseServer();
  const { data } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  return data?.signedUrl ?? null;
}

/**
 * Turn the spoken brief into text the client can edit into a script.
 * Returns the transcript rather than writing it straight into the script —
 * a rough dictation shouldn't silently overwrite something already written.
 */
export async function transcribeBriefAction(videoId: string) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { data: v } = await supabase
    .from("videos")
    .select("brief_voice_path")
    .eq("id", videoId)
    .maybeSingle();
  if (!v?.brief_voice_path) return { error: "No recording to transcribe." };

  const url = await briefVoiceUrl(v.brief_voice_path);
  if (!url) return { error: "Couldn't read the recording." };

  try {
    const res = await transcribeAudio(url);
    if ("error" in res) return { error: res.error };
    return { ok: true, text: res.text };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Hook library — openings worth reusing
// ---------------------------------------------------------------------------

export async function listHookSnippets(): Promise<HookSnippet[]> {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("hook_snippets")
    .select("*")
    .order("times_used", { ascending: false })
    .order("created_at", { ascending: false });
  return (data as HookSnippet[]) ?? [];
}

export async function saveHookSnippetAction(input: {
  text: string;
  note?: string;
  sourceVideoId?: string | null;
}) {
  const me = await requireRole("owner", "admin");
  const text = input.text.trim();
  if (!text) return { error: "Nothing to save." };

  const supabase = await supabaseServer();
  const { error } = await supabase.from("hook_snippets").insert({
    text,
    note: input.note?.trim() || null,
    source_video_id: input.sourceVideoId ?? null,
    created_by: me.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/scripting");
  return { ok: true };
}

/**
 * Bump the counter when a saved hook gets pulled into a script.
 * Deliberately not named `useHookSnippet` — a `use` prefix makes ESLint treat
 * the call as a React hook and reject it inside a callback.
 */
export async function markHookSnippetUsedAction(id: string) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { data: row } = await supabase
    .from("hook_snippets")
    .select("times_used")
    .eq("id", id)
    .maybeSingle();
  await supabase
    .from("hook_snippets")
    .update({ times_used: (row?.times_used ?? 0) + 1 })
    .eq("id", id);
  return { ok: true };
}

export async function deleteHookSnippetAction(id: string) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { error } = await supabase.from("hook_snippets").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/scripting");
  return { ok: true };
}
