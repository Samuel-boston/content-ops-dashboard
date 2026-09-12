"use client";

import Link from "next/link";
import { useState } from "react";
import { IconCheck, IconChevronLeft, IconChevronRight } from "@/components/ui/icons";
import type { MonthMarker } from "@/app/pricing-actions";

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Which month of an editor's work you're looking at.
 *
 * This used to be a flat row of the eight most recent months, which is fine
 * for the first eight months of a working relationship and then quietly stops
 * being fine: month nine pushes month one off the end and there is no way back
 * to it at all. A year at a time fixes that permanently — the row is always
 * twelve cells wide however long the relationship runs, and stepping between
 * years is one click.
 *
 * Months with no work are shown greyed rather than hidden, because a gap is
 * information: it's the difference between "nothing was delivered in March"
 * and "March is missing from this list".
 */
export function MonthPicker({
  editorId,
  markers,
  selected,
}: {
  editorId: string;
  markers: MonthMarker[];
  selected: string;
}) {
  const years = [...new Set(markers.map((m) => Number(m.month.slice(0, 4))))].sort((a, b) => b - a);
  const selectedYear = Number(selected.slice(0, 4));
  const [year, setYear] = useState(
    years.includes(selectedYear) ? selectedYear : (years[0] ?? new Date().getFullYear())
  );

  const byMonth = new Map(markers.map((m) => [m.month, m]));
  const yearMarkers = markers.filter((m) => m.month.startsWith(String(year)));
  const settled = yearMarkers.filter((m) => m.paid).length;

  const idx = years.indexOf(year);
  const older = idx >= 0 && idx < years.length - 1 ? years[idx + 1] : null;
  const newer = idx > 0 ? years[idx - 1] : null;

  return (
    <div className="rounded-xl border border-line bg-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          disabled={older === null}
          onClick={() => older !== null && setYear(older)}
          aria-label="Previous year"
          className="rounded p-1 text-ink-3 transition hover:bg-hover hover:text-ink disabled:opacity-30"
        >
          <IconChevronLeft size={13} />
        </button>
        <span className="text-sm font-semibold tabular-nums">{year}</span>
        <button
          type="button"
          disabled={newer === null}
          onClick={() => newer !== null && setYear(newer)}
          aria-label="Next year"
          className="rounded p-1 text-ink-3 transition hover:bg-hover hover:text-ink disabled:opacity-30"
        >
          <IconChevronRight size={13} />
        </button>

        <span className="ml-auto text-[11px] text-ink-3">
          {yearMarkers.length === 0
            ? "No months delivered"
            : `${yearMarkers.length} month${yearMarkers.length === 1 ? "" : "s"} · ${settled} settled`}
        </span>
      </div>

      <div className="grid grid-cols-6 gap-1 sm:grid-cols-12">
        {SHORT.map((label, i) => {
          const key = `${year}-${String(i + 1).padStart(2, "0")}`;
          const marker = byMonth.get(key);
          const isSelected = key === selected;

          if (!marker) {
            return (
              <span
                key={key}
                title={`Nothing delivered in ${label} ${year}`}
                className="rounded-md px-1 py-1.5 text-center text-[11px] text-ink-3/40"
              >
                {label}
              </span>
            );
          }

          return (
            <Link
              key={key}
              href={`/team/${editorId}?month=${key}`}
              aria-current={isSelected ? "page" : undefined}
              title={marker.paid ? `${label} ${year} — settled` : `${label} ${year} — unpaid`}
              className={`relative rounded-md px-1 py-1.5 text-center text-[11px] transition ${
                isSelected
                  ? "bg-accent font-medium text-white"
                  : "border border-line text-ink-2 hover:bg-hover hover:text-ink"
              }`}
            >
              {label}
              {marker.paid ? (
                <span
                  className={`absolute right-0.5 top-0.5 ${
                    isSelected ? "text-white/80" : "text-ok"
                  }`}
                >
                  <IconCheck size={8} />
                </span>
              ) : (
                <span className="absolute right-1 top-1 h-1 w-1 rounded-full bg-warn" />
              )}
            </Link>
          );
        })}
      </div>

      <p className="mt-2 flex items-center gap-3 text-[10px] text-ink-3">
        <span className="flex items-center gap-1">
          <span className="text-ok">
            <IconCheck size={8} />
          </span>
          settled
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1 w-1 rounded-full bg-warn" />
          unpaid
        </span>
      </p>
    </div>
  );
}
