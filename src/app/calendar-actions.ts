"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole, requireUser } from "@/lib/auth";
import { annotateOverdue } from "@/lib/priorities";
import type { VideoStatus, VideoWithEditor } from "@/lib/types";

const EDITOR_SELECT =
  "*, assigned_editor:profiles!videos_assigned_editor_id_fkey (id, full_name, email)";

/** A video on the calendar, with everything the grid needs to colour it. */
export interface CalendarVideo extends VideoWithEditor {
  overdue: boolean;
  /**
   * The editor promised delivery *after* this video is meant to go out — the
   * schedule can't hold. Surfaced on the day cell and in the day panel.
   */
  etaAfterPostDate: boolean;
}

export interface CalendarData {
  scheduled: CalendarVideo[];
  /**
   * Finished work with nowhere to go yet. This is the rail beside the grid:
   * approved and ready to post, but nobody's picked a date.
   */
  unscheduled: CalendarVideo[];
}

function decorate(rows: VideoWithEditor[]): CalendarVideo[] {
  return annotateOverdue(rows).map((v) => ({
    ...v,
    etaAfterPostDate: Boolean(
      v.eta_at &&
        v.post_date &&
        // Compare on the date, not the instant — an ETA at 6pm on the post day
        // is fine, an ETA the day after is not.
        new Date(v.eta_at).setHours(0, 0, 0, 0) > new Date(`${v.post_date}T00:00:00`).getTime()
    ),
  }));
}

/**
 * A VA has no row access under RLS (see posting-actions.ts), so their calendar
 * is served with the service role — and the rows are stripped down to what a
 * calendar shows. Scripts, briefs and notes never leave this function.
 */
function forViewOnly(rows: VideoWithEditor[] | null): VideoWithEditor[] {
  return (rows ?? []).map(
    (v) =>
      ({
        ...v,
        script_hooks: [],
        script_body: null,
        script_cta: null,
        brief: null,
        idea_notes: null,
        frameio_url: null,
        raw_footage_url: null,
        drive_file_url: null,
      }) as VideoWithEditor
  );
}

export async function calendarData(fromISO: string, toISO: string): Promise<CalendarData> {
  const viewer = await requireUser();
  const viewOnly = viewer.role === "va";
  const supabase = viewOnly ? supabaseAdmin() : await supabaseServer();

  const [{ data: dated }, { data: undated }] = await Promise.all([
    supabase
      .from("videos")
      .select(EDITOR_SELECT)
      .is("parked_at", null)
      .not("post_date", "is", null)
      .gte("post_date", fromISO)
      .lte("post_date", toISO)
      .order("post_date"),
    supabase
      .from("videos")
      .select(EDITOR_SELECT)
      .is("parked_at", null)
      .is("post_date", null)
      .in("status", ["ready_to_post", "final_review", "awaiting_variants", "in_review"])
      .order("priority_rank", { ascending: false })
      .order("stage_entered_at"),
  ]);

  const pick = (rows: unknown) =>
    viewOnly ? forViewOnly(rows as VideoWithEditor[] | null) : ((rows as VideoWithEditor[]) ?? []);
  return {
    scheduled: decorate(pick(dated)),
    unscheduled: decorate(pick(undated)),
  };
}

/* ------------------------------------------------- the weekly posting plan -- */

export interface CadenceSlot {
  id: string;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number;
  format: string;
  platform: string | null;
  note: string | null;
  position: number;
}

/**
 * The intended rhythm of a week — "two talking heads on Monday, a skit on
 * Thursday". A template rather than a schedule: it holds no video ids and
 * never moves on its own.
 */
export async function listCadenceSlots(): Promise<CadenceSlot[]> {
  const viewer = await requireUser();
  const supabase = viewer.role === "va" ? supabaseAdmin() : await supabaseServer();
  const { data } = await supabase
    .from("cadence_slots")
    .select("id, weekday, format, platform, note, position")
    .order("weekday")
    .order("position");
  return (data as CadenceSlot[]) ?? [];
}

export async function addCadenceSlotAction(input: {
  weekday: number;
  format: string;
  platform?: string | null;
  note?: string | null;
}) {
  await requireRole("owner", "admin");
  if (!Number.isInteger(input.weekday) || input.weekday < 1 || input.weekday > 7) {
    return { error: "Pick a day of the week." };
  }
  if (!input.format.trim()) return { error: "Give the slot a format." };

  const supabase = await supabaseServer();

  // Append within the day. Read-then-write is fine here: the plan is edited by
  // one person, occasionally, and a duplicate position only affects tie-break
  // ordering — not correctness.
  const { data: last } = await supabase
    .from("cadence_slots")
    .select("position")
    .eq("weekday", input.weekday)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("cadence_slots").insert({
    weekday: input.weekday,
    format: input.format.trim(),
    platform: input.platform?.trim() || null,
    note: input.note?.trim() || null,
    position: ((last?.position as number) ?? -1) + 1,
  });
  if (error) return { error: error.message };

  revalidatePath("/calendar");
  return { ok: true };
}

export async function deleteCadenceSlotAction(id: string) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { error } = await supabase.from("cadence_slots").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/calendar");
  return { ok: true };
}

/** Drag-and-drop target: move a video to a date, or back to the unscheduled rail. */
export async function setPostDateAction(videoId: string, dateISO: string | null) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("videos")
    .update({ post_date: dateISO })
    .eq("id", videoId);
  if (error) return { error: error.message };

  revalidatePath("/calendar");
  revalidatePath("/");
  revalidatePath(`/videos/${videoId}`);
  return { ok: true };
}

/** Bulk stage move, for the board's multi-select. */
export async function bulkSetStatusAction(ids: string[], status: VideoStatus) {
  // Not manager-only: the copywriter moves scripts along their own board.
  // RLS and the guard trigger decide which moves each role may make.
  await requireUser();
  if (!ids.length) return { error: "Nothing selected." };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("videos").update({ status }).in("id", ids);
  if (error) return { error: error.message };
  revalidatePath("/board");
  revalidatePath("/");
  return { ok: true, moved: ids.length };
}

export async function bulkAssignAction(ids: string[], editorId: string | null) {
  await requireRole("owner", "admin");
  if (!ids.length) return { error: "Nothing selected." };
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("videos")
    .update({ assigned_editor_id: editorId })
    .in("id", ids);
  if (error) return { error: error.message };
  revalidatePath("/board");
  revalidatePath("/");
  return { ok: true, moved: ids.length };
}
