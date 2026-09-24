"use server";

import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentProfile, requireUser } from "@/lib/auth";
import { EDITOR_STATUSES, type Profile, type VideoStatus, type VideoWithEditor } from "@/lib/types";

/**
 * What one editor has on their plate right now, plus how the month is going.
 *
 * Deliberately capacity and delivery only — what they're holding, when they
 * said it lands, what shipped. No turnaround averages, no speed ranking, no
 * comparison between editors: that was explicitly cut from the brief.
 */
export interface EditorSnapshot {
  editor: Pick<Profile, "id" | "full_name" | "email">;
  /** Everything assigned and not yet posted, newest stage first. */
  inFlight: VideoWithEditor[];
  /** Currently being edited or revised — the "working on right now" line. */
  active: VideoWithEditor[];
  /** Assigned but not yet approved by the client. */
  awaitingApproval: VideoWithEditor[];
  /** Assigned work with no ETA on it — the thing the client actually chases. */
  missingEta: VideoWithEditor[];
  /** ETA already in the past and still not delivered. */
  overdue: VideoWithEditor[];
  postedThisMonth: number;
  /** Only populated for viewers allowed to see this editor's pay. */
  earnedThisMonthCents: number | null;
}

const EDITOR_SELECT =
  "*, assigned_editor:profiles!videos_assigned_editor_id_fkey (id, full_name, email)";

function startOfMonthISO(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export async function teamSnapshots(): Promise<EditorSnapshot[]> {
  const me = await requireUser();
  const supabase = await supabaseServer();

  const { data: editors } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("role", "editor")
    .eq("active", true)
    .order("full_name");
  if (!editors?.length) return [];

  const ids = editors.map((e) => e.id);
  const monthStart = startOfMonthISO();

  const [{ data: open }, { data: posted }] = await Promise.all([
    supabase
      .from("videos")
      .select(EDITOR_SELECT)
      .is("parked_at", null)
      .in("assigned_editor_id", ids)
      .neq("status", "posted")
      .order("eta_at", { ascending: true, nullsFirst: false }),
    supabase
      .from("videos")
      .select("assigned_editor_id, price_cents")
      .in("assigned_editor_id", ids)
      .eq("status", "posted")
      .gte("posted_at", monthStart),
  ]);

  const now = Date.now();
  const rows = (open as VideoWithEditor[]) ?? [];

  return editors.map((editor) => {
    const mine = rows.filter((v) => v.assigned_editor_id === editor.id);
    const shipped = (posted ?? []).filter((p) => p.assigned_editor_id === editor.id);
    const canSeePay = me.role === "owner" || me.id === editor.id;

    return {
      editor,
      inFlight: mine,
      active: mine.filter((v) => v.status === "in_progress" || v.status === "revisions"),
      awaitingApproval: mine.filter((v) =>
        (["in_review", "awaiting_variants", "final_review"] as VideoStatus[]).includes(v.status)
      ),
      missingEta: mine.filter(
        (v) => !v.eta_at && (EDITOR_STATUSES as VideoStatus[]).includes(v.status)
      ),
      overdue: mine.filter((v) => v.eta_at && new Date(v.eta_at).getTime() < now),
      postedThisMonth: shipped.length,
      earnedThisMonthCents: canSeePay
        ? shipped.reduce((n, p) => n + ((p.price_cents as number) ?? 0), 0)
        : null,
    };
  });
}

/** One editor's snapshot, for the detail page. */
export async function editorSnapshot(editorId: string): Promise<EditorSnapshot | null> {
  const all = await teamSnapshots();
  return all.find((s) => s.editor.id === editorId) ?? null;
}

/**
 * The client's "what do I need to do" list. Everything here is waiting on the
 * client specifically — nothing an editor could clear.
 */
export interface ClientActions {
  toReview: VideoWithEditor[];
  toFinalReview: VideoWithEditor[];
  /** Scripted and waiting to be shot — the client's own input. */
  toFilm: VideoWithEditor[];
  poolCount: number;
  /** True when the Ready to Edit pool is running dry — i.e. go and film. */
  poolRunningDry: boolean;
}

export async function clientActions(): Promise<ClientActions> {
  const me = await getCurrentProfile();
  const supabase = await supabaseServer();

  const { data } = await supabase
    .from("videos")
    .select(EDITOR_SELECT)
    .is("parked_at", null)
    .neq("status", "posted")
    .order("priority_rank", { ascending: false })
    .order("stage_entered_at", { ascending: true });

  const rows = (data as VideoWithEditor[]) ?? [];
  const pool = rows.filter((v) => v.status === "ready_to_edit");

  return {
    toReview: rows.filter((v) => v.status === "in_review"),
    toFinalReview: rows.filter((v) => v.status === "final_review"),
    toFilm: rows.filter((v) => v.status === "ready_to_film"),
    poolCount: pool.length,
    // Three is roughly a week of work for a small team; below that the client
    // needs to be filming, not waiting to be told the pool hit zero.
    poolRunningDry: me?.role !== "editor" && pool.length < 3,
  };
}
