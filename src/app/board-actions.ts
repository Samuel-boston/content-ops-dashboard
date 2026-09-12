"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { setStatusAction } from "@/app/actions";
import { getWorkspaceSettings, integrationStatus } from "@/lib/workspace";
import type { BoardCard, Video, VideoAsset, VideoStatus, VideoWithEditor } from "@/lib/types";

const EDITOR_SELECT =
  "*, assigned_editor:profiles!videos_assigned_editor_id_fkey (id, full_name, email)";

/**
 * Board rows enriched with what a card needs to render: the main cut's latest
 * thumbnail, duration and version number, plus its open comment count.
 *
 * Done as four flat queries rather than a nested PostgREST select because the
 * "latest version per cut" and "unresolved root comments per cut" shapes both
 * need aggregation PostgREST won't do — and four indexed round-trips is far
 * cheaper than the N+1 this replaces.
 */
export async function listBoardCards(): Promise<BoardCard[]> {
  const supabase = await supabaseServer();

  const { data: videos } = await supabase
    .from("videos")
    .select(EDITOR_SELECT)
    .is("parked_at", null)
    .neq("status", "posted")
    .order("board_position", { ascending: true, nullsFirst: false })
    .order("priority_rank", { ascending: false })
    .order("stage_entered_at", { ascending: true });

  const rows = (videos as VideoWithEditor[]) ?? [];
  if (!rows.length) return [];

  const { data: cuts } = await supabase
    .from("video_cuts")
    .select("id, video_id")
    .eq("kind", "main")
    .in(
      "video_id",
      rows.map((v) => v.id)
    );

  const cutByVideo = new Map((cuts ?? []).map((c) => [c.video_id as string, c.id as string]));
  const cutIds = [...cutByVideo.values()];

  const [{ data: versions }, { data: comments }] = await Promise.all([
    cutIds.length
      ? supabase
          .from("cut_versions")
          .select("cut_id, version, thumbnail_url, duration_seconds")
          .in("cut_id", cutIds)
          .order("version", { ascending: false })
      : Promise.resolve({ data: [] as never[] }),
    cutIds.length
      ? supabase
          .from("cut_comments")
          .select("cut_id")
          .in("cut_id", cutIds)
          .eq("resolved", false)
          .is("parent_comment_id", null)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  // Versions come back newest-first, so the first hit per cut is the latest.
  const topByCut = new Map<string, { version: number; thumbnail_url: string | null; duration_seconds: number | null }>();
  for (const v of versions ?? []) {
    if (!topByCut.has(v.cut_id)) topByCut.set(v.cut_id, v);
  }

  const openByCut = new Map<string, number>();
  for (const c of comments ?? []) {
    openByCut.set(c.cut_id, (openByCut.get(c.cut_id) ?? 0) + 1);
  }

  return rows.map((v) => {
    const cutId = cutByVideo.get(v.id);
    const top = cutId ? topByCut.get(cutId) : undefined;
    return {
      ...v,
      thumbnail_url: top?.thumbnail_url ?? null,
      duration_seconds: top?.duration_seconds ?? null,
      version: top?.version ?? null,
      open_comments: cutId ? openByCut.get(cutId) ?? 0 : 0,
    };
  });
}

/** Gap between hand-placed cards. Big enough to halve many times over. */
const STEP = 1024;

/**
 * Place a card between two neighbours using sparse float ordering: the new
 * position is the midpoint of the cards either side of the drop. That keeps a
 * reorder to a single-row update — no renumbering the whole column — and the
 * gaps only run out after ~50 consecutive drops into the exact same slot.
 */
function midpoint(before: number | null, after: number | null): number {
  if (before == null && after == null) return STEP;
  if (before == null) return (after as number) - STEP;
  if (after == null) return before + STEP;
  return (before + after) / 2;
}

/**
 * Drag-and-drop target for the board: move a card into `toStatus` and place it
 * between `beforeId` and `afterId` (either may be null at a column's edge).
 *
 * Status changes are delegated to setStatusAction so a drag gets exactly the
 * same side effects as the dropdown — revision pings, the Stream→Drive archive
 * on Posted, the empty-pool Telegram alert — rather than quietly bypassing them.
 */
export async function moveVideoAction(input: {
  id: string;
  toStatus: VideoStatus;
  beforeId: string | null;
  afterId: string | null;
}) {
  await requireUser();
  const supabase = await supabaseServer();

  const { data: current } = await supabase
    .from("videos")
    .select("id, status")
    .eq("id", input.id)
    .maybeSingle();
  if (!current) return { error: "Not found." };

  // Read the neighbours' positions to work out where "between" is.
  const neighbourIds = [input.beforeId, input.afterId].filter(Boolean) as string[];
  const { data: neighbours } = neighbourIds.length
    ? await supabase.from("videos").select("id, board_position").in("id", neighbourIds)
    : { data: [] as { id: string; board_position: number | null }[] };

  const posOf = (id: string | null) =>
    id ? (neighbours ?? []).find((n) => n.id === id)?.board_position ?? null : null;

  const position = midpoint(posOf(input.beforeId), posOf(input.afterId));

  if (current.status !== input.toStatus) {
    // Guard triggers and RLS still apply here — an editor dropping a card into
    // Approved is rejected by the database, not just hidden in the UI.
    const res = await setStatusAction(input.id, input.toStatus);
    if (res?.error) return res;
  }

  const { error } = await supabase
    .from("videos")
    .update({ board_position: position })
    .eq("id", input.id);
  if (error) return { error: error.message };

  revalidatePath("/board");
  revalidatePath("/ready-to-edit");
  revalidatePath(`/videos/${input.id}`);
  return { ok: true };
}

/**
 * Everything the board's quick-view drawer needs, in one round trip — the
 * lightweight alternative to opening a video's full page. Used right after
 * creating a video, so you land on the board and can fill in the basics
 * without leaving it, and from clicking a card without losing the board
 * behind you.
 */
export async function getVideoQuickView(videoId: string): Promise<{
  video: Video;
  assets: VideoAsset[];
  driveConfigured: boolean;
} | null> {
  await requireUser();
  const supabase = await supabaseServer();
  const [{ data: video }, { data: assets }, settings] = await Promise.all([
    supabase.from("videos").select("*").eq("id", videoId).maybeSingle(),
    supabase.from("video_assets").select("*").eq("video_id", videoId).order("created_at", { ascending: false }),
    getWorkspaceSettings(),
  ]);
  if (!video) return null;

  const withUrls = await Promise.all(
    ((assets as VideoAsset[]) ?? []).map(async (a) => {
      if (a.storage_path && !a.drive_url) {
        const { data: signed } = await supabase.storage.from("footage").createSignedUrl(a.storage_path, 3600);
        return { ...a, signed_url: signed?.signedUrl };
      }
      return a;
    })
  );

  return {
    video: video as Video,
    assets: withUrls,
    driveConfigured: integrationStatus(settings).drive,
  };
}
