"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireRole, requireUser } from "@/lib/auth";
import { videoPriceCents } from "@/lib/pricing";
import type { BrollCategory, EditorRate, VideoWithEditor } from "@/lib/types";

const EDITOR_SELECT =
  "*, assigned_editor:profiles!videos_assigned_editor_id_fkey (id, full_name, email)";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-09" → "September 2026". Fixed names: this crosses the hydration boundary. */
function labelFor(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/* ------------------------------------------------------------- the months -- */

/**
 * A video with the money attached.
 *
 * The price is resolved once, server-side: the snapshot taken at posting where
 * one exists, otherwise a forecast at today's rates. Doing it here rather than
 * per-row in the UI is what stops a month header and its own rows disagreeing.
 */
export interface PricedVideo extends VideoWithEditor {
  priceCents: number;
  /** True when this is a forecast rather than the figure locked in at posting. */
  estimated: boolean;
  /**
   * No rate covers any of this video's formats, so it prices at nothing.
   * Surfaced as "no rate" rather than "$0.00" — a zero looks like a bug, and
   * the fix is a conversation with the client, not a support ticket.
   */
  unrated: boolean;
}

export interface EditorMonth {
  /** "2026-09" */
  month: string;
  label: string;
  videos: PricedVideo[];
  /**
   * Everything assigned in this month, at its price. Not gated on approval or
   * posting: the work was done in this month, so it belongs to this month.
   */
  totalCents: number;
  /** Of that total, how much has actually gone out. Context, not a gate. */
  postedCount: number;
  /** True once the owner has settled this month. */
  paid: boolean;
  paidCents: number | null;
  paidAt: string | null;
  /** How this editor wants to be paid for this month specifically. */
  paymentLink: string | null;
  paymentNote: string | null;
}

export interface EditorBoard {
  months: EditorMonth[];
  /** Everything live, for the priority strip. */
  active: VideoWithEditor[];
  currency: string;
  /** False when the owner hasn't set any rates for this person yet. */
  hasRates: boolean;
  /** Carried forward when a month has no link of its own. */
  lastKnownPaymentLink: string | null;
}

/**
 * An editor's whole working life, grouped by the month the work started.
 *
 * The month a video counts toward is the month it was *assigned*, not the
 * month it posted. An editor who cuts eight videos in September has earned
 * eight videos in September, whatever the client's approval queue is doing in
 * October — and a month whose total keeps moving after it closes is a month
 * nobody can invoice.
 */
export async function editorBoard(editorId?: string): Promise<EditorBoard> {
  const me = await requireUser();
  const target = editorId ?? me.id;
  if (me.role === "editor" && target !== me.id) {
    return { months: [], active: [], currency: "USD", hasRates: false, lastKnownPaymentLink: null };
  }

  const supabase = await supabaseServer();
  const [{ data: videos }, { data: rateRows }, { data: settings }, { data: payments }, { data: billing }] =
    await Promise.all([
      supabase
        .from("videos")
        .select(EDITOR_SELECT)
        .is("parked_at", null)
        .eq("assigned_editor_id", target)
        .order("priority_rank", { ascending: false })
        .order("stage_entered_at"),
      supabase.from("editor_rates").select("*").eq("editor_id", target),
      supabase
        .from("workspace_settings")
        .select("hook_variant_surcharge_cents, currency")
        .eq("id", 1)
        .maybeSingle(),
      supabase.from("editor_payments").select("*").eq("editor_id", target),
      supabase
        .from("editor_month_billing")
        .select("*")
        .eq("editor_id", target)
        .order("month", { ascending: false }),
    ]);

  const rows = (videos as VideoWithEditor[]) ?? [];
  const rates = (rateRows as EditorRate[]) ?? [];
  const surcharge = (settings?.hook_variant_surcharge_cents as number) ?? 200;

  const paidBy = new Map(
    ((payments as { month: string; amount_cents: number; paid_at: string }[]) ?? []).map((p) => [
      p.month,
      p,
    ])
  );
  const billingBy = new Map(
    ((billing as { month: string; payment_link: string | null; note: string | null }[]) ?? []).map(
      (b) => [b.month, b]
    )
  );

  const ratedFormats = new Set(rates.map((r) => r.format));
  const priced: PricedVideo[] = rows.map((v) => ({
    ...v,
    priceCents: v.price_cents ?? videoPriceCents(v, rates, surcharge),
    estimated: v.price_cents == null,
    unrated:
      (v.price_cents ?? 0) === 0 &&
      !(v.formats ?? []).some((f) => ratedFormats.has(f)),
  }));

  const by = new Map<string, PricedVideo[]>();
  for (const v of priced) {
    // Anything somehow missing a stamp falls into the month it entered its
    // current stage — better than a null bucket nobody opens.
    const key = monthKey(new Date(v.assigned_at ?? v.stage_entered_at ?? v.created_at));
    const list = by.get(key) ?? [];
    list.push(v);
    by.set(key, list);
  }

  const months: EditorMonth[] = [...by.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, list]) => {
      const payment = paidBy.get(month);
      const bill = billingBy.get(month);
      return {
        month,
        label: labelFor(month),
        videos: list,
        totalCents: list.reduce((n, v) => n + v.priceCents, 0),
        postedCount: list.filter((v) => v.status === "posted").length,
        paid: Boolean(payment),
        paidCents: payment?.amount_cents ?? null,
        paidAt: payment?.paid_at ?? null,
        paymentLink: bill?.payment_link ?? null,
        paymentNote: bill?.note ?? null,
      };
    });

  return {
    months,
    active: priced.filter((v) => v.status !== "posted"),
    currency: (settings?.currency as string) ?? "USD",
    hasRates: rates.length > 0,
    lastKnownPaymentLink:
      ((billing as { payment_link: string | null }[]) ?? []).find((b) => b.payment_link)
        ?.payment_link ?? null,
  };
}

/** An editor sets how they want paying for one month. Only ever their own. */
export async function saveMonthBillingAction(input: {
  month: string;
  link: string;
  note: string;
}) {
  const me = await requireUser();
  if (!/^\d{4}-\d{2}$/.test(input.month)) return { error: "Not a month." };

  const supabase = await supabaseServer();
  const { error } = await supabase.from("editor_month_billing").upsert(
    {
      editor_id: me.id,
      month: input.month,
      payment_link: input.link.trim() || null,
      note: input.note.trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "editor_id,month" }
  );
  if (error) return { error: error.message };
  revalidatePath("/my-work");
  revalidatePath(`/team/${me.id}`);
  return { ok: true };
}

/* --------------------------------------------------------- b-roll library -- */

export async function listBrollCategories(): Promise<BrollCategory[]> {
  await requireUser();
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("broll_categories")
    .select("*")
    .order("position")
    .order("name");
  return (data as BrollCategory[]) ?? [];
}

/**
 * Add a category to the index.
 *
 * Creating the matching folder in Drive is deliberately not done here: the
 * Drive service account isn't connected yet, and silently creating nothing
 * would be worse than saying so. Once it is, this is where that call goes.
 */
export async function addBrollCategoryAction(input: { name: string; driveUrl?: string }) {
  await requireRole("owner", "admin");
  const name = input.name.trim();
  if (!name) return { error: "Give the category a name." };

  const supabase = await supabaseServer();
  const { data: last } = await supabase
    .from("broll_categories")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("broll_categories").insert({
    name,
    drive_url: input.driveUrl?.trim() || null,
    position: ((last?.position as number) ?? -1) + 1,
  });
  if (error) {
    if (error.code === "23505") return { error: "There's already a category with that name." };
    return { error: error.message };
  }
  revalidatePath("/library/broll");
  return { ok: true };
}

export async function updateBrollCategoryAction(
  id: string,
  patch: { name?: string; driveUrl?: string | null; note?: string | null }
) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();

  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    if (!patch.name.trim()) return { error: "A category needs a name." };
    update.name = patch.name.trim();
  }
  if (patch.driveUrl !== undefined) update.drive_url = patch.driveUrl?.trim() || null;
  if (patch.note !== undefined) update.note = patch.note?.trim() || null;

  const { error } = await supabase.from("broll_categories").update(update).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/library/broll");
  return { ok: true };
}

export async function deleteBrollCategoryAction(id: string) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { error } = await supabase.from("broll_categories").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/library/broll");
  return { ok: true };
}
