"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import type { MusicTrack, ReferenceItem, SopDoc } from "@/lib/types";

// ---------------------------------------------------------------------------
// Music library
// ---------------------------------------------------------------------------

export async function listMusic(): Promise<{ categories: string[]; tracks: MusicTrack[] }> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("music_tracks")
    .select("*")
    .order("category")
    .order("title");
  const tracks = (data as MusicTrack[]) ?? [];
  const withUrls = await Promise.all(
    tracks.map(async (t) => {
      const { data: signed } = await supabase.storage
        .from("music")
        .createSignedUrl(t.storage_path, 3600);
      return { ...t, signed_url: signed?.signedUrl };
    })
  );
  const categories = [...new Set(tracks.map((t) => t.category))].sort();
  return { categories, tracks: withUrls };
}

export async function createMusicUploadUrlAction(filename: string) {
  await requireUser();
  const supabase = await supabaseServer();
  const ext = filename.split(".").pop()?.toLowerCase() || "mp3";
  const path = `${crypto.randomUUID()}.${ext}`;
  const { data, error } = await supabase.storage.from("music").createSignedUploadUrl(path);
  if (error) return { error: error.message };
  return { ok: true, path, token: data.token, signedUrl: data.signedUrl };
}

export async function registerMusicTrackAction(input: {
  title: string;
  category: string;
  storagePath: string;
  durationSeconds?: number | null;
}) {
  const me = await requireUser();
  const supabase = await supabaseServer();
  const { error } = await supabase.from("music_tracks").insert({
    title: input.title.trim() || "Untitled",
    category: input.category.trim() || "Uncategorised",
    storage_path: input.storagePath,
    duration_seconds: input.durationSeconds ?? null,
    uploaded_by: me.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/library/music");
  return { ok: true };
}

export async function updateMusicTrackAction(
  id: string,
  patch: Partial<Pick<MusicTrack, "title" | "category">>
) {
  await requireUser();
  const supabase = await supabaseServer();
  const { error } = await supabase.from("music_tracks").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/library/music");
  return { ok: true };
}

export async function deleteMusicTrackAction(id: string) {
  await requireUser();
  const supabase = await supabaseServer();
  const { data: t } = await supabase.from("music_tracks").select("storage_path").eq("id", id).single();
  if (t?.storage_path) await supabase.storage.from("music").remove([t.storage_path]);
  const { error } = await supabase.from("music_tracks").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/library/music");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reference / inspiration
// ---------------------------------------------------------------------------

export async function listReferences(
  videoId?: string | null
): Promise<ReferenceItem[]> {
  const supabase = await supabaseServer();
  let q = supabase.from("reference_items").select("*").order("created_at", { ascending: false });
  q = videoId ? q.eq("video_id", videoId) : q.is("video_id", null);
  const { data } = await q;
  const items = (data as ReferenceItem[]) ?? [];
  return Promise.all(
    items.map(async (it) => {
      if ((it.kind === "image" || it.kind === "video") && it.storage_path) {
        const { data: signed } = await supabase.storage
          .from("references")
          .createSignedUrl(it.storage_path, 3600);
        return { ...it, signed_url: signed?.signedUrl };
      }
      return it;
    })
  );
}

export async function createReferenceUploadUrlAction(filename: string) {
  await requireUser();
  const supabase = await supabaseServer();
  const ext = filename.split(".").pop()?.toLowerCase() || "png";
  const path = `${crypto.randomUUID()}.${ext}`;
  const { data, error } = await supabase.storage.from("references").createSignedUploadUrl(path);
  if (error) return { error: error.message };
  return { ok: true, path, token: data.token, signedUrl: data.signedUrl };
}

export async function addReferenceAction(input: {
  videoId?: string | null;
  kind: "image" | "link";
  storagePath?: string | null;
  url?: string | null;
  note?: string;
}) {
  const me = await requireUser();
  const supabase = await supabaseServer();
  const { error } = await supabase.from("reference_items").insert({
    video_id: input.videoId ?? null,
    kind: input.kind,
    storage_path: input.storagePath ?? null,
    url: input.url ?? null,
    note: input.note?.trim() || null,
    added_by: me.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/library/references");
  if (input.videoId) revalidatePath(`/videos/${input.videoId}`);
  return { ok: true };
}

export async function setReferenceStatusAction(
  id: string,
  status: "open" | "used" | "dismissed"
) {
  await requireUser();
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("reference_items")
    .update({ status, last_activity_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/library/references");
  return { ok: true };
}

export async function deleteReferenceAction(id: string) {
  await requireUser();
  const supabase = await supabaseServer();
  const { data: r } = await supabase
    .from("reference_items")
    .select("storage_path, video_id")
    .eq("id", id)
    .single();
  if (r?.storage_path) await supabase.storage.from("references").remove([r.storage_path]);
  const { error } = await supabase.from("reference_items").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/library/references");
  if (r?.video_id) revalidatePath(`/videos/${r.video_id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// SOP / playbook
// ---------------------------------------------------------------------------

export async function listSop(): Promise<SopDoc[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("sop_docs").select("*").order("position").order("title");
  return (data as SopDoc[]) ?? [];
}

export async function createSopAction(formData: FormData) {
  await requireUser();
  const supabase = await supabaseServer();
  const title = String(formData.get("title") || "").trim();
  if (!title) return { error: "Title required." };
  const { error } = await supabase.from("sop_docs").insert({
    title,
    format: String(formData.get("format") || "").trim() || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/library/sop");
  return { ok: true };
}

export async function updateSopAction(
  id: string,
  patch: Partial<Pick<SopDoc, "title" | "format" | "body">>
) {
  await requireUser();
  const supabase = await supabaseServer();
  const { error } = await supabase.from("sop_docs").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/library/sop");
  return { ok: true };
}

export async function deleteSopAction(id: string) {
  await requireUser();
  const supabase = await supabaseServer();
  const { error } = await supabase.from("sop_docs").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/library/sop");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Music: attaching a track to a video is what makes "where it's been used"
// work, so it's a single action and nothing else has to be filled in.
// ---------------------------------------------------------------------------

/** Every track, with the videos it's been attached to. */
export async function listMusicWithUsage(): Promise<{
  categories: string[];
  tracks: MusicTrack[];
}> {
  const { categories, tracks } = await listMusic();
  if (!tracks.length) return { categories, tracks };

  const supabase = await supabaseServer();
  const { data: links } = await supabase
    .from("video_music")
    .select("track_id, video:videos (id, title, post_date)")
    .in("track_id", tracks.map((t) => t.id));

  const byTrack = new Map<string, { id: string; title: string; post_date: string | null }[]>();
  for (const row of (links ?? []) as unknown as {
    track_id: string;
    video: { id: string; title: string; post_date: string | null } | null;
  }[]) {
    if (!row.video) continue;
    const list = byTrack.get(row.track_id) ?? [];
    list.push(row.video);
    byTrack.set(row.track_id, list);
  }

  return {
    categories,
    tracks: tracks.map((t) => ({ ...t, used_on: byTrack.get(t.id) ?? [] })),
  };
}

export async function attachTrackAction(videoId: string, trackId: string) {
  const me = await requireUser();
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("video_music")
    .upsert({ video_id: videoId, track_id: trackId, added_by: me.id }, { onConflict: "video_id,track_id" });
  if (error) return { error: error.message };
  revalidatePath("/library/music");
  revalidatePath(`/videos/${videoId}`);
  return { ok: true };
}

export async function detachTrackAction(videoId: string, trackId: string) {
  await requireUser();
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("video_music")
    .delete()
    .eq("video_id", videoId)
    .eq("track_id", trackId);
  if (error) return { error: error.message };
  revalidatePath("/library/music");
  revalidatePath(`/videos/${videoId}`);
  return { ok: true };
}

/** Videos a track can be dropped onto — anything still in flight. */
export async function attachableVideos(): Promise<{ id: string; title: string }[]> {
  await requireUser();
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("videos")
    .select("id, title")
    .neq("status", "posted")
    .order("stage_entered_at", { ascending: false })
    .limit(60);
  return (data as { id: string; title: string }[]) ?? [];
}

/**
 * The tracks already picked for one video, with playable URLs.
 *
 * Signed at read time rather than stored — the music bucket is private, and a
 * URL that outlives the page it was minted for is a link that leaks.
 */
export async function videoMusic(videoId: string): Promise<MusicTrack[]> {
  await requireUser();
  const supabase = await supabaseServer();

  const { data: links } = await supabase
    .from("video_music")
    .select("track:music_tracks (*)")
    .eq("video_id", videoId);

  const tracks = ((links ?? []) as unknown as { track: MusicTrack | null }[])
    .map((r) => r.track)
    .filter((t): t is MusicTrack => Boolean(t));

  return Promise.all(
    tracks.map(async (t) => {
      const { data } = await supabase.storage
        .from("music")
        .createSignedUrl(t.storage_path, 60 * 60 * 6);
      return { ...t, signed_url: data?.signedUrl };
    })
  );
}
