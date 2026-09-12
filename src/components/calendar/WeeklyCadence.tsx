"use client";

import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { IconPlus, IconX } from "@/components/ui/icons";
import {
  addCadenceSlotAction,
  deleteCadenceSlotAction,
  type CadenceSlot,
} from "@/app/calendar-actions";

const DAYS = [
  { weekday: 1, short: "Mon", long: "Monday" },
  { weekday: 2, short: "Tue", long: "Tuesday" },
  { weekday: 3, short: "Wed", long: "Wednesday" },
  { weekday: 4, short: "Thu", long: "Thursday" },
  { weekday: 5, short: "Fri", long: "Friday" },
  { weekday: 6, short: "Sat", long: "Saturday" },
  { weekday: 7, short: "Sun", long: "Sunday" },
];

/** Same hue rule as the calendar's pillar colouring, so formats read consistently. */
function formatHue(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) % 360;
  return h;
}

/**
 * The week as a plan: what goes out on each day, and in what format.
 *
 * This replaced a 26-week heatmap of what had already posted. The heatmap was
 * a fact with no decision attached to it — you can't act on "you posted four
 * times in March". A plan you can act on: it's the target the month grid above
 * is measured against, and the thing you hand someone when they ask what the
 * week is supposed to look like.
 */
export function WeeklyCadence({
  slots,
  formats,
  platforms,
  canEdit,
}: {
  slots: CadenceSlot[];
  formats: string[];
  platforms: string[];
  canEdit: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();
  const [addingTo, setAddingTo] = useState<number | null>(null);
  const [format, setFormat] = useState("");
  const [platform, setPlatform] = useState("");

  const byDay = new Map<number, CadenceSlot[]>();
  for (const s of slots) {
    const list = byDay.get(s.weekday) ?? [];
    list.push(s);
    byDay.set(s.weekday, list);
  }

  const perWeek = slots.length;

  function add(weekday: number) {
    if (!format) return;
    startTransition(async () => {
      const res = await addCadenceSlotAction({
        weekday,
        format,
        platform: platform || null,
      });
      if (res?.error) toast.error(res.error);
      else {
        setFormat("");
        setPlatform("");
        setAddingTo(null);
        router.refresh();
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteCadenceSlotAction(id);
      if (res?.error) toast.error(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-card p-3">
      <div className="mb-2.5 flex flex-wrap items-baseline gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          Posting cadence
        </h3>
        <span className="text-[11px] text-ink-3">
          the plan for a normal week ·{" "}
          <span className="tabular-nums text-ink-2">
            {perWeek} post{perWeek === 1 ? "" : "s"}
          </span>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
        {DAYS.map((day) => {
          const daySlots = byDay.get(day.weekday) ?? [];
          const isAdding = addingTo === day.weekday;

          return (
            <div
              key={day.weekday}
              className={`flex min-h-28 flex-col gap-1 rounded-lg border p-1.5 transition ${
                daySlots.length ? "border-line bg-panel" : "border-dashed border-line bg-transparent"
              }`}
            >
              <span className="flex items-baseline gap-1 px-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                  {day.short}
                </span>
                {daySlots.length > 1 ? (
                  <span className="ml-auto text-[10px] tabular-nums text-ink-3">
                    {daySlots.length}
                  </span>
                ) : null}
              </span>

              {daySlots.map((s) => {
                const colour = `hsl(${formatHue(s.format)} 65% 60%)`;
                return (
                  <span
                    key={s.id}
                    className="group flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] leading-tight"
                    style={{ background: `color-mix(in srgb, ${colour} 14%, transparent)` }}
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: colour }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{s.format}</span>
                      {s.platform ? (
                        <span className="block truncate text-[10px] text-ink-3">{s.platform}</span>
                      ) : null}
                    </span>
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => remove(s.id)}
                        disabled={pending}
                        aria-label={`Remove ${s.format} from ${day.long}`}
                        className="shrink-0 rounded p-0.5 text-ink-3 opacity-0 transition hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <IconX size={10} />
                      </button>
                    ) : null}
                  </span>
                );
              })}

              {isAdding ? (
                <div className="space-y-1">
                  <select
                    autoFocus
                    value={format}
                    onChange={(e) => setFormat(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setAddingTo(null);
                    }}
                    className="w-full rounded-md border border-line bg-raised px-1.5 py-1 text-[11px] focus:border-accent focus:outline-none"
                  >
                    <option value="">Format…</option>
                    {formats.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                  <select
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setAddingTo(null);
                    }}
                    className="w-full rounded-md border border-line bg-raised px-1.5 py-1 text-[11px] focus:border-accent focus:outline-none"
                  >
                    <option value="">Any platform</option>
                    {platforms.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => add(day.weekday)}
                      disabled={pending || !format}
                      className="flex-1 rounded-md bg-accent py-1 text-[10px] font-medium text-white hover:bg-accent-hi disabled:opacity-40"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddingTo(null)}
                      className="rounded-md border border-line px-1.5 py-1 text-[10px] text-ink-3 hover:text-ink"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : canEdit ? (
                <button
                  type="button"
                  onClick={() => {
                    setAddingTo(day.weekday);
                    setFormat("");
                    setPlatform("");
                  }}
                  aria-label={`Add a post on ${day.long}`}
                  className="mt-auto flex items-center justify-center gap-1 rounded-md py-1 text-[10px] text-ink-3 transition hover:bg-hover hover:text-ink"
                >
                  <IconPlus size={10} />
                  Add
                </button>
              ) : null}
            </div>
          );
        })}
      </div>


      {slots.length === 0 && canEdit ? (
        <p className="mt-2 text-[11px] text-ink-3">
          Nothing planned yet. Add what a normal week should look like and the calendar has
          something to measure against.
        </p>
      ) : null}
    </div>
  );
}
