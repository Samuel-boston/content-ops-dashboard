"use client";

import { useEffect, useRef, useState } from "react";
import { IconChevronDown, IconPause, IconPlay, IconX } from "@/components/ui/icons";
import { readTime } from "@/lib/format";

/**
 * Full-screen scrolling script, for reading off while filming.
 *
 * Speed is in words per minute rather than pixels per second, so the same
 * setting reads at the same pace whatever the font size or screen — 150 wpm is
 * a natural piece-to-camera delivery.
 */
export function Teleprompter({
  hooks,
  body,
  onClose,
}: {
  /** Every hook, in order — each is read in turn, labelled, so nobody has to go hunting for the other takes. */
  hooks: string[];
  body: string;
  onClose: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const script = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState(false);
  const [wpm, setWpm] = useState(150);
  const [size, setSize] = useState(40);
  const [mirror, setMirror] = useState(false);

  const cleanHooks = hooks.map((h) => h.trim()).filter(Boolean);
  // No call to action: mid-flow, a reader would just say "call to action" out loud.
  const text = [...cleanHooks, body].filter(Boolean).join("\n\n");
  const total = readTime(text);
  const seconds = total.words ? Math.round((total.words / wpm) * 60) : 0;

  useEffect(() => {
    if (!running) return;
    const el = scroller.current;
    const inner = script.current;
    if (!el || !inner) return;

    const distance = el.scrollHeight - el.clientHeight;
    // Nothing to scroll. Drop out of the running state rather than sitting on
    // a Pause button that will never do anything.
    if (distance <= 0) {
      setRunning(false);
      return;
    }

    // Pace off the *text*, not the scrollable distance. The scroller carries
    // 35vh of lead-in and 40vh of run-off so the reading line sits mid-screen;
    // dividing the whole distance by the script's duration made a short script
    // crawl through all that empty space and look frozen. Words per line is
    // what the eye actually tracks, so px-per-word is the honest unit — and it
    // makes the pace slider mean something, which it previously didn't.
    const pxPerWord = inner.offsetHeight / Math.max(1, total.words);
    const pxPerMs = (pxPerWord * wpm) / 60000;

    // Position is accumulated here as a float rather than read back out of
    // scrollTop each frame. A comfortable reading pace works out around a
    // quarter-pixel per frame, and scrollTop snaps to whole device pixels on
    // read-back — so `scrollTop += 0.25` rounded straight back to where it
    // started and the script sat completely still. Seeded from the element so
    // pausing and resuming continues from where the reader actually is.
    let position = el.scrollTop;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      // Clamped because requestAnimationFrame stops entirely in a background
      // tab: switch away for thirty seconds and the first frame back would
      // otherwise carry a thirty-second dt and leap most of the script.
      const dt = Math.min(now - last, 100);
      last = now;
      position += pxPerMs * dt;
      el.scrollTop = position;
      if (position >= distance - 1) setRunning(false);
      else raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [running, total.words, wpm, size]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === " ") {
        e.preventDefault();
        setRunning((r) => !r);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-black">
      <div className="flex flex-wrap items-center gap-3 border-b border-line/40 px-4 py-2.5">
        <span className="text-xs text-white/60">
          {total.words} words · about{" "}
          {seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`} at this
          pace
        </span>

        <label className="flex items-center gap-1.5 text-xs text-white/60">
          Pace
          <input
            type="range"
            min={80}
            // Well past conversational delivery (~150) on purpose: the top of
            // the range isn't for reading aloud, it's for running the script
            // through quickly to check the flow, or for anyone who just reads
            // faster than the average. The duration readout beside it keeps
            // the number honest either way.
            max={400}
            step={10}
            value={wpm}
            onChange={(e) => setWpm(Number(e.target.value))}
            className="w-24 accent-[var(--color-accent)]"
          />
          <span className="w-14 tabular-nums">{wpm} wpm</span>
        </label>

        <label className="flex items-center gap-1.5 text-xs text-white/60">
          Size
          <input
            type="range"
            min={24}
            max={80}
            step={4}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="w-20 accent-[var(--color-accent)]"
          />
        </label>

        <label className="flex items-center gap-1.5 text-xs text-white/60">
          <input
            type="checkbox"
            checked={mirror}
            onChange={(e) => setMirror(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--color-accent)]"
          />
          Mirror
        </label>

        <button
          type="button"
          onClick={() => {
            if (scroller.current) scroller.current.scrollTop = 0;
            setRunning(false);
          }}
          className="rounded-lg border border-white/20 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/10"
        >
          Back to top
        </button>

        <button
          type="button"
          onClick={() => setRunning((r) => !r)}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hi"
        >
          {running ? <IconPause size={13} /> : <IconPlay size={13} />}
          {running ? "Pause" : "Start"}
        </button>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close teleprompter"
          className="ml-auto rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
        >
          <IconX size={16} />
        </button>
      </div>

      <div
        ref={scroller}
        className="flex-1 overflow-y-auto px-[8vw] py-[35vh]"
        style={{ transform: mirror ? "scaleX(-1)" : undefined }}
      >
        {/*
          A teleprompter column is narrow on purpose, and it took measuring to
          see why. At full width this held eight words a line, so scrolling at
          a correct 150 wpm moved the page about 18px a second — technically
          the right pace, visually indistinguishable from a still page, and the
          pace slider spanned a useless 11-26px/s. Cutting the measure to about
          four words a line multiplies the travel per word: the text moves
          visibly, the slider does something you can feel, and the eye stops
          tracking halfway across a monitor between words. `ch` rather than a
          pixel width so it stays four-ish words at any font size.
        */}
        <div ref={script} className="mx-auto" style={{ maxWidth: "48ch" }}>
          {cleanHooks.map((h, i) => (
            <div key={i} className="mb-10">
              <p
                className="mb-1 font-semibold uppercase tracking-wider text-white/40"
                style={{ fontSize: size * 0.4 }}
              >
                Hook {i + 1}
              </p>
              <p
                className="whitespace-pre-wrap font-semibold leading-tight text-accent-hi"
                style={{ fontSize: size * 1.05 }}
              >
                {h}
              </p>
            </div>
          ))}
          {body.trim() ? (
            <div>
              <p
                className="mb-1 font-semibold uppercase tracking-wider text-white/40"
                style={{ fontSize: size * 0.4 }}
              >
                Body
              </p>
              <p className="whitespace-pre-wrap leading-snug text-white" style={{ fontSize: size }}>
                {body}
              </p>
            </div>
          ) : null}
        </div>
        <p className="mt-[40vh] text-center text-white/30" style={{ fontSize: size * 0.4 }}>
          End of script
        </p>
      </div>

      {/* Reading line — where your eyes should sit. */}
      <div className="pointer-events-none absolute inset-x-0 top-[35vh] flex items-center gap-2 px-[6vw]">
        <span className="h-px flex-1 bg-accent/40" />
        <IconChevronDown size={14} className="text-accent/60" />
        <span className="h-px flex-1 bg-accent/40" />
      </div>
    </div>
  );
}
