"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import {
  IconCheck,
  IconChart,
  IconChevronLeft,
  IconChevronRight,
  IconTrash,
} from "@/components/ui/icons";
import { buildMonthGrid, iso } from "@/lib/calendar";
import {
  addTimeOffAction,
  deleteTimeOffAction,
  markMonthPaidAction,
  unmarkMonthPaidAction,
} from "@/app/pricing-actions";
import { dayMonth, money } from "@/lib/format";
import type { EditorPayment, TimeOff } from "@/lib/types";

/** Monday-first, to match the grid. Fixed strings keep SSR and the client identical. */
const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** Settle a month, and print a statement off the same numbers. */
export function PaymentControls({
  editorId,
  month,
  totalCents,
  currency,
  payment,
  isOwner,
  paymentLink = null,
  paymentNote = null,
}: {
  editorId: string;
  month: string;
  totalCents: number;
  currency: string;
  payment: EditorPayment | null;
  isOwner: boolean;
  /** Where this editor asked to be paid for this month. Owner-visible only. */
  paymentLink?: string | null;
  paymentNote?: string | null;
}) {
  const toast = useToast();
  const router = useRouter();
  const [, startTransition] = useTrackedTransition();

  return (
    <div className="space-y-2">
      {isOwner && (paymentLink || paymentNote) ? (
        <div className="rounded-lg border border-line bg-panel px-2.5 py-2 text-[11px]">
          <span className="text-ink-3">Pay this month to </span>
          {paymentLink ? (
            <a
              href={paymentLink}
              target="_blank"
              rel="noreferrer noopener"
              className="break-all text-accent-hi hover:underline"
            >
              {paymentLink}
            </a>
          ) : (
            <span className="text-ink-3">— no link set</span>
          )}
          {paymentNote ? <p className="mt-0.5 text-ink-2">{paymentNote}</p> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
      {payment ? (
        <span className="flex items-center gap-1.5 rounded-lg bg-ok/10 px-2.5 py-1.5 text-[11px] text-ok">
          <IconCheck size={12} />
          Paid {money(payment.amount_cents, currency, { maximumFractionDigits: 2 })} on{" "}
          {dayMonth(payment.paid_at)}
        </span>
      ) : (
        <span className="rounded-lg bg-warn/10 px-2.5 py-1.5 text-[11px] text-warn">Unpaid</span>
      )}

      {isOwner ? (
        payment ? (
          <button
            type="button"
            onClick={() =>
              startTransition(async () => {
                const res = await unmarkMonthPaidAction(editorId, month);
                if (res?.error) toast.error(res.error);
                else router.refresh();
              })
            }
            className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-3 hover:text-danger"
          >
            Undo
          </button>
        ) : (
          <button
            type="button"
            disabled={totalCents === 0}
            onClick={() =>
              startTransition(async () => {
                const res = await markMonthPaidAction({
                  editorId,
                  month,
                  amountCents: totalCents,
                });
                if (res?.error) toast.error(res.error);
                else {
                  toast.success("Marked as paid.");
                  router.refresh();
                }
              })
            }
            className="rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-accent-hi disabled:opacity-40"
          >
            Mark paid
          </button>
        )
      ) : null}

      <Link
        href={`/team/${editorId}/statement?month=${month}`}
        className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-2 hover:bg-hover hover:text-ink"
      >
        <IconChart size={12} />
        Statement
      </Link>
      </div>
    </div>
  );
}

/**
 * Time off, as a month you can look at.
 *
 * It was a list of date pairs, which reads like paperwork and answers the
 * wrong question — you don't want to parse "10 Sep – 14 Sep", you want to
 * glance at a week and see whether it's clear. So: a calendar. Green is
 * available, red is away, and booking a stretch off is click the first day,
 * click the last.
 *
 * Optional by design. An editor says when they're away if they want to; the
 * pipeline never blocks on it and nothing here is required.
 */
export function TimeOffPanel({
  editorId,
  entries,
  canEdit,
}: {
  editorId: string;
  entries: TimeOff[];
  canEdit: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();

  const today = useMemo(() => new Date(), []);
  const [view, setView] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [anchor, setAnchor] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const grid = useMemo(() => buildMonthGrid(view.year, view.month), [view]);
  const todayISO = useMemo(() => iso(today), [today]);

  /** Every day covered by a booking, so a cell is a map lookup rather than a scan. */
  const awayDays = useMemo(() => {
    const map = new Map<string, TimeOff>();
    for (const t of entries) {
      const cursor = new Date(`${t.starts_on}T00:00:00`);
      const end = new Date(`${t.ends_on}T00:00:00`);
      // Guard against a reversed or absurd range turning this into a long loop.
      let guard = 0;
      while (cursor <= end && guard < 400) {
        map.set(iso(cursor), t);
        cursor.setDate(cursor.getDate() + 1);
        guard += 1;
      }
    }
    return map;
  }, [entries]);

  function onDayClick(key: string) {
    if (!canEdit) return;

    // Clicking an existing booking clears it — the same gesture, reversed.
    const existing = awayDays.get(key);
    if (existing) {
      setAnchor(null);
      startTransition(async () => {
        const res = await deleteTimeOffAction(existing.id, editorId);
        if (res?.error) toast.error(res.error);
        else router.refresh();
      });
      return;
    }

    if (!anchor) {
      setAnchor(key);
      return;
    }

    // Second click closes the range, in whichever order the two were picked.
    const [startsOn, endsOn] = anchor <= key ? [anchor, key] : [key, anchor];
    setAnchor(null);
    startTransition(async () => {
      const res = await addTimeOffAction({ editorId, startsOn, endsOn, note });
      if (res?.error) toast.error(res.error);
      else {
        setNote("");
        router.refresh();
      }
    });
  }

  function shift(delta: number) {
    const d = new Date(view.year, view.month + delta, 1);
    setView({ year: d.getFullYear(), month: d.getMonth() });
    setAnchor(null);
  }

  const awayThisMonth = grid.weeks
    .flat()
    .filter((d): d is Date => !!d && awayDays.has(iso(d))).length;

  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-sm font-semibold">Availability</h2>
        <span className="text-xs text-ink-3">
          {awayThisMonth ? `${awayThisMonth} day${awayThisMonth === 1 ? "" : "s"} off` : "all clear"}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => shift(-1)}
            aria-label="Previous month"
            className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
          >
            <IconChevronLeft size={13} />
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            aria-label="Next month"
            className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
          >
            <IconChevronRight size={13} />
          </button>
        </div>
      </div>
      <p className="mb-3 text-[11px] leading-snug text-ink-3">
        {grid.label}
        {canEdit
          ? anchor
            ? ` · from ${dayMonth(anchor)} — click the last day`
            : " · click a day, then the last day, to book time off"
          : ""}
      </p>

      {canEdit && anchor ? (
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className="mb-2 w-full rounded-md border border-line bg-raised px-2 py-1.5 text-xs placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
      ) : null}

      <div className="grid grid-cols-7 gap-1">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span
            key={i}
            aria-hidden
            className="pb-0.5 text-center text-[9px] uppercase tracking-wider text-ink-3"
          >
            {d}
          </span>
        ))}

        {grid.weeks.flat().map((date, i) => {
          if (!date) return <span key={i} />;
          const key = iso(date);
          const off = awayDays.get(key);
          const isAnchor = anchor === key;
          const isToday = key === todayISO;

          return (
            <button
              key={i}
              type="button"
              disabled={!canEdit || pending}
              onClick={() => onDayClick(key)}
              title={
                off
                  ? `Away${off.note ? ` — ${off.note}` : ""}${canEdit ? " · click to clear" : ""}`
                  : // Built by hand rather than with toLocaleDateString: the
                    // server and the browser resolve the default locale
                    // differently, so "1 Saturday" was hydrating over
                    // "Saturday 1" and tripping a mismatch on every cell.
                    `${WEEKDAY_NAMES[(date.getDay() + 6) % 7]} ${date.getDate()}`
              }
              aria-label={`${date.getDate()} ${grid.label} — ${off ? "away" : "available"}`}
              aria-pressed={!!off}
              className={`flex aspect-square items-center justify-center rounded-md text-[11px] tabular-nums transition disabled:cursor-default ${
                off
                  ? "bg-danger/20 font-medium text-danger hover:bg-danger/30"
                  : isAnchor
                    ? "bg-accent font-medium text-white"
                    : "bg-ok/10 text-ok hover:bg-ok/20"
              } ${isToday ? "ring-1 ring-inset ring-ink-3" : ""}`}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-3">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-ok/40" />
          Available
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-danger/50" />
          Away
        </span>
        {anchor ? (
          <button
            type="button"
            onClick={() => setAnchor(null)}
            className="ml-auto text-ink-3 hover:text-ink"
          >
            Cancel
          </button>
        ) : null}
      </div>

      {entries.length ? (
        <div className="mt-3 space-y-1 border-t border-line pt-2.5">
          {entries.map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-[11px]">
              <span className="text-ink-2">
                {dayMonth(t.starts_on)} – {dayMonth(t.ends_on)}
              </span>
              {t.note ? <span className="truncate text-ink-3">{t.note}</span> : null}
              {canEdit ? (
                <button
                  type="button"
                  onClick={() =>
                    startTransition(async () => {
                      const res = await deleteTimeOffAction(t.id, editorId);
                      if (res?.error) toast.error(res.error);
                      else router.refresh();
                    })
                  }
                  aria-label={`Remove ${dayMonth(t.starts_on)} to ${dayMonth(t.ends_on)}`}
                  className="ml-auto rounded p-1 text-ink-3 hover:text-danger"
                >
                  <IconTrash size={11} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
