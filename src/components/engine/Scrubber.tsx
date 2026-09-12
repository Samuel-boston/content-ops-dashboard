"use client";

import { useRef, useState } from "react";
import type { CutComment } from "@/lib/types";

interface Props {
  duration: number;
  current: number;
  comments: CutComment[];
  onSeek: (t: number) => void;
  /** Fires when the user finishes marking a point (end === null) or a range. */
  onMark: (start: number, end: number | null) => void;
  activeCommentId?: string | null;
  onPinClick?: (c: CutComment) => void;
}

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

export function Scrubber({
  duration,
  current,
  comments,
  onSeek,
  onMark,
  activeCommentId,
  onPinClick,
}: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const pct = (t: number) => (duration > 0 ? Math.min(100, Math.max(0, (t / duration) * 100)) : 0);
  const tAt = (clientX: number) => {
    const el = barRef.current;
    if (!el || duration <= 0) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration));
  };

  const pinned = comments.filter((c) => c.t_start_seconds != null && !c.parent_comment_id);

  return (
    <div className="select-none">
      <div
        ref={barRef}
        className="relative h-11 cursor-pointer touch-none rounded-md border border-line-strong bg-card"
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          const t = tAt(e.clientX);
          setDrag({ from: t, to: t });
        }}
        onPointerMove={(e) => {
          setHover(tAt(e.clientX));
          if (drag) setDrag({ ...drag, to: tAt(e.clientX) });
        }}
        onPointerLeave={() => setHover(null)}
        onPointerUp={(e) => {
          const to = tAt(e.clientX);
          if (drag) {
            const a = Math.min(drag.from, to);
            const b = Math.max(drag.from, to);
            if (b - a < 0.4) {
              onSeek(a);
              onMark(a, null);
            } else {
              onMark(a, b);
            }
          }
          setDrag(null);
        }}
      >
        {/* played progress */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 rounded-l-md bg-hover/40"
          style={{ width: `${pct(current)}%` }}
        />

        {/* existing range comments, drawn as bands across the bar */}
        {pinned
          .filter((c) => c.t_end_seconds != null)
          .map((c) => (
            <div
              key={`band-${c.id}`}
              className={`pointer-events-none absolute inset-y-0 ${
                c.resolved
                  ? "bg-line-strong/20"
                  : activeCommentId === c.id
                    ? "bg-accent/30"
                    : "bg-accent/15"
              }`}
              style={{
                left: `${pct(c.t_start_seconds!)}%`,
                width: `${Math.max(0.5, pct(c.t_end_seconds!) - pct(c.t_start_seconds!))}%`,
              }}
            />
          ))}

        {/* live drag selection */}
        {drag && Math.abs(drag.to - drag.from) > 0.4 ? (
          <div
            className="pointer-events-none absolute inset-y-0 border-x border-accent-hi bg-accent/25"
            style={{
              left: `${pct(Math.min(drag.from, drag.to))}%`,
              width: `${Math.abs(pct(drag.to) - pct(drag.from))}%`,
            }}
          />
        ) : null}

        {/* playhead */}
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-amber-400"
          style={{ left: `${pct(current)}%` }}
        >
          <span className="absolute -top-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-amber-400" />
        </div>

        {/* hover time readout */}
        {hover != null && !drag ? (
          <div
            className="pointer-events-none absolute -top-6 rounded bg-raised px-1.5 py-0.5 font-mono text-[10px] text-ink-2"
            style={{ left: `${pct(hover)}%`, transform: "translateX(-50%)" }}
          >
            {fmt(hover)}
          </div>
        ) : null}

        {/* comment pins */}
        {pinned.map((c) => (
          <button
            key={c.id}
            title={c.body}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onSeek(c.t_start_seconds!);
              onPinClick?.(c);
            }}
            className="absolute -top-1.5 -translate-x-1/2"
            style={{ left: `${pct(c.t_start_seconds!)}%` }}
            aria-label={`Comment at ${fmt(c.t_start_seconds!)}`}
          >
            <span
              className={`block h-3 w-3 rotate-45 rounded-[2px] ring-2 ring-app ${
                c.resolved
                  ? "bg-line-strong"
                  : activeCommentId === c.id
                    ? "bg-accent-hi"
                    : "bg-accent"
              }`}
            />
          </button>
        ))}
      </div>

      <div className="mt-1 flex justify-between font-mono text-[11px] text-ink-3">
        <span>{fmt(current)}</span>
        <span className="hidden text-ink-3 sm:inline">click = point · drag = range</span>
        <span>{fmt(duration)}</span>
      </div>
    </div>
  );
}

export { fmt as formatTime };
