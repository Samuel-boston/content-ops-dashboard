"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireRole, requireUser } from "@/lib/auth";
import type { Series, SeriesWithVideos, VideoWithEditor } from "@/lib/types";

const EDITOR_SELECT =
  "*, assigned_editor:profiles!videos_assigned_editor_id_fkey (id, full_name, email)";

function revalidateSeries(videoId?: string) {
  revalidatePath("/series");
  revalidatePath("/calendar");
  revalidatePath("/board");
  if (videoId) revalidatePath(`/videos/${videoId}`);
}

/** Every series with its parts, in story order. */
export async function listSeries(): Promise<SeriesWithVideos[]> {
  await requireUser();
  const supabase = await supabaseServer();

  const [{ data: series }, { data: videos }] = await Promise.all([
    supabase.from("series").select("*").order("created_at", { ascending: false }),
    supabase
      .from("videos")
      .select(EDITOR_SELECT)
      .not("series_id", "is", null)
      .order("series_position", { ascending: true, nullsFirst: false }),
  ]);

  const rows = (videos as VideoWithEditor[]) ?? [];
  return ((series as Series[]) ?? []).map((s) => ({
    ...s,
    videos: rows.filter((v) => v.series_id === s.id),
  }));
}

/** Just the names, for the picker on a video. */
export async function listSeriesOptions(): Promise<Series[]> {
  await requireUser();
  const supabase = await supabaseServer();
  const { data } = await supabase.from("series").select("*").order("title");
  return (data as Series[]) ?? [];
}

export async function createSeriesAction(title: string, note?: string) {
  const me = await requireRole("owner", "admin");
  const t = title.trim();
  if (!t) return { error: "Give the series a name." };

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("series")
    .insert({ title: t, note: note?.trim() || null, created_by: me.id })
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidateSeries();
  return { ok: true, id: data.id as string };
}

export async function renameSeriesAction(id: string, title: string, note?: string) {
  await requireRole("owner", "admin");
  const t = title.trim();
  if (!t) return { error: "Give the series a name." };

  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("series")
    .update({ title: t, note: note?.trim() || null })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidateSeries();
  return { ok: true };
}

/**
 * Deleting a series releases its videos rather than taking them with it —
 * `on delete set null` on the foreign key. Losing a plan shouldn't lose the
 * work, and there's no undo here.
 */
export async function deleteSeriesAction(id: string) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { error } = await supabase.from("series").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateSeries();
  return { ok: true };
}

/**
 * Put a video in a series, or take it out.
 *
 * The slot is assigned here rather than asked for: a new part goes on the end,
 * which is what "add to this series" almost always means. Reordering is a
 * separate, deliberate action.
 */
export async function setVideoSeriesAction(videoId: string, seriesId: string | null) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();

  if (!seriesId) {
    const { error } = await supabase
      .from("videos")
      .update({ series_id: null, series_position: null })
      .eq("id", videoId);
    if (error) return { error: error.message };
    revalidateSeries(videoId);
    return { ok: true };
  }

  const { data: existing } = await supabase
    .from("videos")
    .select("series_position")
    .eq("series_id", seriesId)
    .not("series_position", "is", null)
    .order("series_position", { ascending: false })
    .limit(1);

  const next = ((existing?.[0]?.series_position as number) ?? 0) + 1;

  const { error } = await supabase
    .from("videos")
    .update({ series_id: seriesId, series_position: next })
    .eq("id", videoId);
  if (error) return { error: error.message };

  revalidateSeries(videoId);
  return { ok: true };
}

/**
 * Move one part up or down.
 *
 * Swaps with its neighbour in two writes, via a temporary slot: the unique
 * index on (series_id, series_position) means writing the neighbour's number
 * directly would collide.
 */
export async function moveInSeriesAction(videoId: string, direction: "up" | "down") {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();

  const { data: video } = await supabase
    .from("videos")
    .select("series_id, series_position")
    .eq("id", videoId)
    .maybeSingle();
  if (!video?.series_id || video.series_position === null) {
    return { error: "That video isn't in a series." };
  }

  const { data: neighbour } = await supabase
    .from("videos")
    .select("id, series_position")
    .eq("series_id", video.series_id)
    .not("series_position", "is", null)
    [direction === "up" ? "lt" : "gt"]("series_position", video.series_position)
    .order("series_position", { ascending: direction !== "up" })
    .limit(1)
    .maybeSingle();

  if (!neighbour) return { error: direction === "up" ? "Already first." : "Already last." };

  const mine = video.series_position as number;
  const theirs = neighbour.series_position as number;

  // Park this one out of the way so the swap can't trip the unique index.
  await supabase.from("videos").update({ series_position: -1 }).eq("id", videoId);
  await supabase.from("videos").update({ series_position: mine }).eq("id", neighbour.id);
  const { error } = await supabase
    .from("videos")
    .update({ series_position: theirs })
    .eq("id", videoId);
  if (error) return { error: error.message };

  revalidateSeries(videoId);
  return { ok: true };
}
