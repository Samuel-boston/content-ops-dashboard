"use client";

import { useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { timecode } from "@/lib/format";
import type { CutComment } from "@/lib/types";

export interface Selection {
  start: number;
  end: number | null;
}

/**
 * The scrub bar: played progress, comment pins (one avatar per commenter at
 * their timecode), range bands for section comments, and — while the Section
 * tool is armed — a draggable in/out selection.
 */
export function Timeline({
  duration,
  current,
  comments,
  activeId,
  selection,
  sectionMode,
  onSeek,
  onSelect,
  onPinClick,
}: {
  duration: number;
  current: number;
  comments: CutComment[];
  activeId: string | null;
  selection: Selection | null;
  sectionMode: boolean;
  onSeek: (t: number) => void;
  onSelect: (s: Selection | null) => void;
  onPinClick: (c: CutComment) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState<"scrub" | "section" | null>(null);
  const sectionAnchor = useRef(0);

  const pct = (t: number) => (duration > 0 ? Math.min(100, Math.max(0, (t / duration) * 100)) : 0);

  const timeAt = (clientX: number) => {
    const el = trackRef.current;
    if (!el || duration <= 0) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = timeAt(e.clientX);
    if (sectionMode) {
      setDragging("section");
      sectionAnchor.current = t;
      onSelect({ start: t, end: null });
    } else {
      setDragging("scrub");
      onSeek(t);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const t = timeAt(e.clientX);
    setHover(t);
    if (dragging === "scrub") onSeek(t);
    else if (dragging === "section") {
      const a = sectionAnchor.current;
      // Dragging either direction is fine; normalise so start < end.
      onSelect(Math.abs(t - a) < 0.15 ? { start: a, end: null } : { start: Math.min(a, t), end: Math.max(a, t) });
    }
  };

  const endDrag = () => setDragging(null);

  // Point comments sit on the rail as avatars; range comments also paint a band.
  const pins = comments.filter((c) => c.t_start_seconds != null && !c.parent_comment_id);
  const ranges = pins.filter((c) => c.t_end_seconds != null && c.t_end_seconds > (c.t_start_seconds ?? 0));

  return (
    <div className="select-none px-4 pb-1 pt-3">
      <div className="relative">
        {/* Track */}
        <div
          ref={trackRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={() => setHover(null)}
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(current)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") onSeek(Math.max(0, current - (e.shiftKey ? 10 : 1)));
            if (e.key === "ArrowRight") onSeek(Math.min(duration, current + (e.shiftKey ? 10 : 1)));
          }}
          className={`group relative h-1.5 w-full touch-none rounded-full bg-line-strong ${
            sectionMode ? "cursor-ew-resize" : "cursor-pointer"
          }`}
        >
          {/* Saved range comments */}
          {ranges.map((c) => (
            <span
              key={`band-${c.id}`}
              className={`absolute top-0 h-full rounded-full ${
                activeId === c.id ? "bg-accent-hi/80" : "bg-accent/35"
              }`}
              style={{
                left: `${pct(c.t_start_seconds as number)}%`,
                width: `${Math.max(0.6, pct(c.t_end_seconds as number) - pct(c.t_start_seconds as number))}%`,
              }}
            />
          ))}

          {/* Live in/out selection */}
          {selection ? (
            <span
              className="absolute top-0 h-full rounded-full bg-accent-hi ring-1 ring-accent-hi"
              style={{
                left: `${pct(selection.start)}%`,
                width: `${Math.max(0.5, pct(selection.end ?? selection.start) - pct(selection.start))}%`,
              }}
            />
          ) : null}

          {/* Played progress */}
          <span
            className="pointer-events-none absolute top-0 h-full rounded-full bg-accent"
            style={{ width: `${pct(current)}%` }}
          />

          {/* Playhead */}
          <span
            className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent shadow"
            style={{ left: `${pct(current)}%` }}
          />

          {/* Hover time readout */}
          {hover != null && !dragging ? (
            <span
              className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded bg-app px-1.5 py-0.5 font-mono text-[10px] text-ink-2 opacity-0 shadow ring-1 ring-line group-hover:opacity-100"
              style={{ left: `${pct(hover)}%` }}
            >
              {timecode(hover)}
            </span>
          ) : null}
        </div>

        {/* Comment pins */}
        <div className="relative mt-2 h-6">
          {pins.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onPinClick(c)}
              title={`${timecode(c.t_start_seconds)} — ${c.body || "Recording"}`}
              className={`absolute top-0 -translate-x-1/2 rounded-full transition ${
                activeId === c.id ? "z-10 scale-115" : "hover:scale-110"
              }`}
              style={{ left: `${pct(c.t_start_seconds as number)}%` }}
            >
              <Avatar
                person={c.author}
                size="md"
                className={
                  activeId === c.id
                    ? "ring-2 ring-accent-hi"
                    : c.resolved
                      ? "opacity-40 ring-2 ring-panel"
                      : "ring-2 ring-panel"
                }
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
