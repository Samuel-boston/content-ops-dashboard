"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Drawing, DrawStroke } from "@/lib/types";
import { IconTrash, IconUndo } from "@/components/ui/icons";

export const DRAW_COLORS = ["#7c5cff", "#f4515f", "#fbbf24", "#34d399", "#ffffff"];

/**
 * Renders a drawing onto a canvas sized to its element box. Points are stored
 * normalised 0..1, so the same annotation is correct at any player size.
 */
function paint(canvas: HTMLCanvasElement, strokes: DrawStroke[]) {
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = canvas.getBoundingClientRect();
  if (!width || !height) return;

  // Only resize when it actually changed — assigning width/height clears the
  // canvas, and doing it every frame makes the live stroke flicker.
  const w = Math.round(width * dpr);
  const h = Math.round(height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    // A soft dark halo keeps bright strokes legible over bright footage.
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0][0] * width, stroke.points[0][1] * height);
    for (let i = 1; i < stroke.points.length; i += 1) {
      ctx.lineTo(stroke.points[i][0] * width, stroke.points[i][1] * height);
    }
    if (stroke.points.length === 1) {
      // A tap with no drag — draw a dot so it isn't invisible.
      ctx.lineTo(stroke.points[0][0] * width + 0.1, stroke.points[0][1] * height);
    }
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

/**
 * Read-only render of a saved drawing, pinned over the video frame.
 *
 * `revealUpTo` drives draw-while-talking playback: strokes stamped with a time
 * appear as the voice note reaches them. Undated strokes always show.
 */
export function DrawingView({
  drawing,
  revealUpTo,
}: {
  drawing: Drawing;
  revealUpTo?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  const visible = useMemo(
    () =>
      revealUpTo == null
        ? drawing.strokes
        : drawing.strokes.filter((s) => s.t == null || s.t <= revealUpTo),
    [drawing.strokes, revealUpTo]
  );

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => paint(canvas, visible);
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [visible]);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" />;
}

/**
 * Interactive drawing surface. Strokes are committed to `onChange` as they
 * finish so the composer always holds the current annotation.
 */
export function DrawLayer({
  value,
  onChange,
  recordingSince,
}: {
  value: Drawing | null;
  onChange: (d: Drawing | null) => void;
  /**
   * performance.now() when the voice note started, if one is recording.
   * Strokes get stamped so playback can replay them in time with the audio.
   */
  recordingSince?: number | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(DRAW_COLORS[0]);
  const strokes = useMemo(() => value?.strokes ?? [], [value]);

  // The stroke currently under the pointer, kept in a ref so the pointermove
  // handler doesn't re-render on every sample.
  const live = useRef<DrawStroke | null>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    paint(canvas, live.current ? [...strokes, live.current] : strokes);
  }, [strokes]);

  useEffect(() => {
    redraw();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [redraw]);

  const pointAt = (e: React.PointerEvent): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    ];
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    live.current = { color, width: 3, points: [pointAt(e)] };
    redraw();
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!live.current) return;
    live.current.points.push(pointAt(e));
    redraw();
  };

  const onUp = () => {
    if (!live.current) return;
    const stroke = live.current;
    live.current = null;
    if (recordingSince != null) {
      stroke.t = Math.max(0, (performance.now() - recordingSince) / 1000);
    }
    onChange({ strokes: [...strokes, stroke] });
  };

  const undo = () => {
    const next = strokes.slice(0, -1);
    onChange(next.length ? { strokes: next } : null);
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
      />
      {/* Palette floats over the frame while drawing is armed. */}
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-app/90 px-2 py-1.5 backdrop-blur">
        {DRAW_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            aria-label={`Pen colour ${c}`}
            aria-pressed={color === c}
            className={`h-5 w-5 rounded-full transition ${
              color === c ? "ring-2 ring-white ring-offset-2 ring-offset-app" : "hover:scale-110"
            }`}
            style={{ background: c }}
          />
        ))}
        <span className="mx-1 h-4 w-px bg-line-strong" />
        <button
          type="button"
          onClick={undo}
          disabled={!strokes.length}
          title="Undo stroke"
          className="rounded-full p-1 text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-30"
        >
          <IconUndo size={14} />
        </button>
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={!strokes.length}
          title="Clear drawing"
          className="rounded-full p-1 text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-30"
        >
          <IconTrash size={14} />
        </button>
      </div>
    </>
  );
}
