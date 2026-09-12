"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentProfile, requireRole, requireUser } from "@/lib/auth";
import { videoPriceCents } from "@/lib/pricing";
import { getWorkspaceSettings } from "@/lib/workspace";
import type {
  EditorPayment,
  EditorRate,
  PriceBreakdown,
  TimeOff,
  VideoStatus,
} from "@/lib/types";

/**
 * Pay is between the client and the editor. RLS already enforces this (owner
 * writes everything, an editor reads only their own row, admins get nothing);
 * these checks just fail earlier and more clearly.
 */
export async function canSeeEditorPay(editorId: string): Promise<boolean> {
  const me = await getCurrentProfile();
  if (!me) return false;
  return me.role === "owner" || me.id === editorId;
}

export async function listEditorRates(editorId?: string): Promise<EditorRate[]> {
  await requireUser();
  const supabase = await supabaseServer();
  let query = supabase.from("editor_rates").select("*").order("format");
  if (editorId) query = query.eq("editor_id", editorId);
  const { data } = await query;
  return (data as EditorRate[]) ?? [];
}

export async function setEditorRateAction(
  editorId: string,
  format: string,
  priceCents: number
) {
  const me = await requireRole("owner");
  if (!Number.isFinite(priceCents) || priceCents < 0) return { error: "Enter a valid amount." };

  const supabase = await supabaseServer();
  const { error } = await supabase.from("editor_rates").upsert(
    {
      editor_id: editorId,
      format,
      price_cents: Math.round(priceCents),
      updated_by: me.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "editor_id,format" }
  );
  if (error) return { error: error.message };
  revalidatePath("/team");
  revalidatePath(`/team/${editorId}`);
  revalidatePath("/settings");
  return { ok: true };
}

export async function setHookSurchargeAction(cents: number) {
  await requireRole("owner");
  if (!Number.isFinite(cents) || cents < 0) return { error: "Enter a valid amount." };
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("workspace_settings")
    .update({ hook_variant_surcharge_cents: Math.round(cents) })
    .eq("id", 1);
  if (error) return { error: error.message };
  revalidatePath("/settings");
  revalidatePath("/team");
  return { ok: true };
}

export interface MonthEarnings {
  month: string;
  videos: {
    id: string;
    title: string;
    posted_at: string | null;
    formats: string[];
    price_cents: number;
    breakdown: PriceBreakdown | null;
    status: VideoStatus;
    /** True while the price is a live estimate — the video hasn't posted yet. */
    estimated: boolean;
  }[];
  total_cents: number;
  count: number;
  /** How much of the total is still an estimate rather than a locked price. */
  estimated_cents: number;
}

/**
 * What an editor earned in a given month.
 *
 * A video counts toward the month it was **assigned**, and everything assigned
 * that month counts — not just what has posted. An editor who cuts eight
 * videos in September has earned eight videos in September, whatever the
 * client's approval queue is doing in October.
 *
 * This deliberately mirrors `editorBoard` in editor-actions.ts, which is what
 * the editor sees on their own dashboard. The two used to disagree — this one
 * counted posted videos in the posting month — so the statement the client
 * printed showed a smaller number than the editor's own screen. Two different
 * answers to "what am I owed" is the one thing a pay screen cannot do.
 *
 * A posted video uses the price snapshotted at posting, so changing a rate
 * today never rewrites a settled month. Anything still in flight is priced
 * live off the current rates and flagged `estimated`.
 */
export async function editorMonthEarnings(
  editorId: string,
  month: string
): Promise<MonthEarnings | null> {
  if (!(await canSeeEditorPay(editorId))) return null;

  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return null;
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));

  const supabase = await supabaseServer();
  const [{ data }, rates, settings] = await Promise.all([
    supabase
      .from("videos")
      .select(
        "id, title, posted_at, assigned_at, stage_entered_at, created_at, formats, " +
          "script_hooks, variants_override, assigned_editor_id, price_cents, price_breakdown, status"
      )
      .eq("assigned_editor_id", editorId)
      .gte("assigned_at", from.toISOString())
      .lt("assigned_at", to.toISOString())
      .order("assigned_at", { ascending: false }),
    listEditorRates(editorId),
    getWorkspaceSettings(),
  ]);

  const surcharge = settings.hook_variant_surcharge_cents ?? 200;

  const videos = ((data ?? []) as unknown as Record<string, unknown>[]).map((v) => {
    const snapshot = v.price_cents as number | null;
    return {
      id: v.id as string,
      title: v.title as string,
      posted_at: v.posted_at as string | null,
      formats: (v.formats as string[]) ?? [],
      price_cents:
        snapshot ??
        videoPriceCents(
          v as unknown as Parameters<typeof videoPriceCents>[0],
          rates,
          surcharge
        ),
      breakdown: (v.price_breakdown as PriceBreakdown) ?? null,
      status: v.status as VideoStatus,
      estimated: snapshot == null,
    };
  });

  return {
    month,
    videos,
    total_cents: videos.reduce((n, v) => n + v.price_cents, 0),
    estimated_cents: videos.filter((v) => v.estimated).reduce((n, v) => n + v.price_cents, 0),
    count: videos.length,
  };
}

/**
 * Which months this editor has work in, newest first ("YYYY-MM").
 *
 * Keyed on when work was *assigned*, matching `editorMonthEarnings` and the
 * editor's own dashboard. Listing only months with posted work would hide the
 * month someone is currently working through, which is the one they most want
 * to look at.
 */
export async function editorMonths(editorId: string): Promise<string[]> {
  await requireUser();
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("videos")
    .select("assigned_at")
    .eq("assigned_editor_id", editorId)
    .not("assigned_at", "is", null)
    .order("assigned_at", { ascending: false });

  const months = new Set<string>();
  for (const row of data ?? []) {
    months.add((row.assigned_at as string).slice(0, 7));
  }
  // Always offer the current month, even before anything has shipped in it.
  months.add(new Date().toISOString().slice(0, 7));
  return [...months].sort().reverse();
}

// ---------------------------------------------------------------------------
// Paying an editor for a month
// ---------------------------------------------------------------------------

export async function listPayments(editorId: string): Promise<EditorPayment[]> {
  if (!(await canSeeEditorPay(editorId))) return [];
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("editor_payments")
    .select("*")
    .eq("editor_id", editorId)
    .order("month", { ascending: false });
  return (data as EditorPayment[]) ?? [];
}

export async function markMonthPaidAction(input: {
  editorId: string;
  month: string;
  amountCents: number;
  note?: string;
}) {
  const me = await requireRole("owner");
  const supabase = await supabaseServer();
  const { error } = await supabase.from("editor_payments").upsert(
    {
      editor_id: input.editorId,
      month: input.month,
      amount_cents: Math.max(0, Math.round(input.amountCents)),
      note: input.note?.trim() || null,
      paid_at: new Date().toISOString(),
      paid_by: me.id,
    },
    { onConflict: "editor_id,month" }
  );
  if (error) return { error: error.message };
  revalidatePath(`/team/${input.editorId}`);
  revalidatePath("/team");
  return { ok: true };
}

export async function unmarkMonthPaidAction(editorId: string, month: string) {
  await requireRole("owner");
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("editor_payments")
    .delete()
    .eq("editor_id", editorId)
    .eq("month", month);
  if (error) return { error: error.message };
  revalidatePath(`/team/${editorId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Time off — always optional. Nobody is required to declare availability.
// ---------------------------------------------------------------------------

/**
 * Every booking, past and future.
 *
 * This used to return only what hadn't ended yet, which suited a list of
 * upcoming absences. The panel is a calendar you can page backwards through
 * now, so filtering by date would quietly blank out any month you scrolled
 * to — including days earlier in the current one.
 */
export async function listTimeOff(editorId?: string): Promise<TimeOff[]> {
  await requireUser();
  const supabase = await supabaseServer();
  let q = supabase.from("editor_time_off").select("*").order("starts_on");
  if (editorId) q = q.eq("editor_id", editorId);
  const { data } = await q;
  return (data as TimeOff[]) ?? [];
}

export async function addTimeOffAction(input: {
  editorId: string;
  startsOn: string;
  endsOn: string;
  note?: string;
}) {
  const me = await requireUser();
  if (me.role !== "owner" && me.id !== input.editorId) {
    return { error: "You can only set your own time off." };
  }
  if (!input.startsOn || !input.endsOn) return { error: "Pick both dates." };
  if (input.endsOn < input.startsOn) return { error: "The end date is before the start." };

  const supabase = await supabaseServer();
  const { error } = await supabase.from("editor_time_off").insert({
    editor_id: input.editorId,
    starts_on: input.startsOn,
    ends_on: input.endsOn,
    note: input.note?.trim() || null,
  });
  if (error) return { error: error.message };
  revalidatePath(`/team/${input.editorId}`);
  revalidatePath("/team");
  revalidatePath("/");
  return { ok: true };
}

export async function deleteTimeOffAction(id: string, editorId: string) {
  await requireUser();
  const supabase = await supabaseServer();
  const { error } = await supabase.from("editor_time_off").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/team/${editorId}`);
  revalidatePath("/team");
  return { ok: true };
}

/**
 * Where this editor asked to be paid for one specific month.
 *
 * Owner-only by RLS — the policy on `editor_month_billing` grants read to the
 * owner and to the editor themselves, so an admin viewing this page gets null
 * rather than an error, which is the right shape for "you don't handle pay".
 */
export async function monthBilling(
  editorId: string,
  month: string
): Promise<{ payment_link: string | null; note: string | null } | null> {
  await requireUser();
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("editor_month_billing")
    .select("payment_link, note")
    .eq("editor_id", editorId)
    .eq("month", month)
    .maybeSingle();
  return (data as { payment_link: string | null; note: string | null } | null) ?? null;
}

export interface MonthMarker {
  month: string;
  /** Whether this month has been settled. */
  paid: boolean;
  paidCents: number | null;
}

/**
 * Every month this editor has work in, with its settled state.
 *
 * One query rather than one per month: the month picker needs to show a whole
 * year at a glance, and a year of round trips to render a set of tabs is the
 * kind of thing that quietly makes a page slow twelve months from now.
 */
export async function editorMonthMarkers(editorId: string): Promise<MonthMarker[]> {
  await requireUser();
  const supabase = await supabaseServer();

  const [months, { data: payments }] = await Promise.all([
    editorMonths(editorId),
    supabase.from("editor_payments").select("month, amount_cents").eq("editor_id", editorId),
  ]);

  const paidBy = new Map(
    ((payments ?? []) as { month: string; amount_cents: number }[]).map((p) => [
      p.month,
      p.amount_cents,
    ])
  );

  return months.map((month) => ({
    month,
    paid: paidBy.has(month),
    paidCents: paidBy.get(month) ?? null,
  }));
}
