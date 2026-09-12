"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PriorityPill, StatusBadge } from "@/components/badges";
import { EtaBadge } from "@/components/pipeline/Eta";
import { IconWarningTriangle, IconX } from "@/components/ui/icons";
import { daysInStage } from "@/lib/priorities";
import { STATUS_LABELS } from "@/lib/types";
import type { StalledVideo } from "@/app/overview-actions";

/**
 * Stalled and overdue videos, as their own alert in the nav — a different
 * kind of notification from the bell (which is "something happened") and
 * Chat (which is "someone mentioned you"). This one means "something's gone
 * quiet and it's on you to unstick it," which is why it gets its own caution
 * icon instead of folding into either.
 */
export function NeedsAttentionBell({ stalled }: { stalled: StalledVideo[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!stalled.length) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-md px-2 py-1 text-warn hover:bg-hover"
        aria-label="Needs attention"
        title={`${stalled.length} video${stalled.length === 1 ? "" : "s"} stalled or past ETA`}
      >
        <IconWarningTriangle size={18} />
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warn px-1 text-[10px] font-semibold text-black">
          {stalled.length > 9 ? "9+" : stalled.length}
        </span>
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed inset-x-3 top-14 z-50 mx-auto max-w-md overflow-hidden rounded-xl border border-warn/40 bg-card shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-1.5 sm:w-96">
            <div className="flex items-center gap-2 border-b border-warn/25 bg-warn/10 px-3.5 py-2.5">
              <span className="text-warn">
                <IconWarningTriangle size={15} />
              </span>
              <h2 className="text-sm font-semibold">Needs attention</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="ml-auto rounded-md p-1 text-ink-3 hover:bg-hover hover:text-ink"
              >
                <IconX size={14} />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {stalled.map((v) => (
                <Link
                  key={v.id}
                  href={`/videos/${v.id}`}
                  onClick={() => setOpen(false)}
                  className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2.5 text-xs last:border-0 hover:bg-hover/50"
                >
                  <PriorityPill priority={v.priority} />
                  <span className="min-w-[120px] flex-1 truncate font-medium">{v.title}</span>
                  <StatusBadge status={v.status} />
                  {v.overdue ? (
                    <EtaBadge etaAt={v.eta_at} stage={v.eta_stage} overdue />
                  ) : (
                    <span className="text-warn">
                      {daysInStage(v)}d in {STATUS_LABELS[v.status]}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
