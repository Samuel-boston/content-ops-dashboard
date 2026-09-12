"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { IconSearch, IconSparkles, IconFile } from "@/components/ui/icons";
import { generateTranscriptAction } from "@/app/engine-actions";
import { timecode } from "@/lib/format";
import type { CutTranscript } from "@/lib/types";

/**
 * Timed transcript. Clicking a cue seeks; selecting text across cues offers to
 * open a comment anchored to exactly the spoken range that was highlighted.
 */
export function TranscriptTab({
  transcript,
  cutId,
  version,
  videoId,
  currentTime,
  canGenerate,
  onSeek,
  onCommentRange,
}: {
  transcript: CutTranscript | null;
  cutId: string;
  version: number;
  videoId: string;
  currentTime: number;
  canGenerate: boolean;
  onSeek: (t: number) => void;
  onCommentRange: (start: number, end: number) => void;
}) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTrackedTransition();
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const cues = transcript?.cues ?? [];
  const activeIndex = cues.findIndex((c) => currentTime >= c.start && currentTime < c.end);

  /**
   * Map the DOM text selection back onto cue timings by walking up to the
   * nearest [data-start] element at each end of the range.
   */
  const readSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !listRef.current) {
      setSelection(null);
      return;
    }
    const cueOf = (node: Node | null) => {
      const el = node instanceof Element ? node : node?.parentElement;
      return el?.closest<HTMLElement>("[data-start]") ?? null;
    };
    const a = cueOf(sel.anchorNode);
    const b = cueOf(sel.focusNode);
    if (!a || !b || !listRef.current.contains(a)) {
      setSelection(null);
      return;
    }
    const starts = [Number(a.dataset.start), Number(b.dataset.start)];
    const ends = [Number(a.dataset.end), Number(b.dataset.end)];
    setSelection({ start: Math.min(...starts), end: Math.max(...ends) });
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", readSelection);
    return () => document.removeEventListener("selectionchange", readSelection);
  }, [readSelection]);

  const matches = query.trim()
    ? cues.filter((c) => c.text.toLowerCase().includes(query.trim().toLowerCase()))
    : cues;

  async function copyAll() {
    await navigator.clipboard.writeText(
      cues.map((c) => `${timecode(c.start)}  ${c.text}`).join("\n")
    );
    toast.success("Transcript copied.");
  }

  if (!transcript) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-ink-3">
        <IconFile size={22} />
        <p className="text-sm">No transcript for this version yet.</p>
        {canGenerate ? (
          <>
            <p className="max-w-60 text-xs">
              Transcribe the cut to search what was said and comment straight onto a phrase.
            </p>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await generateTranscriptAction(cutId, version, videoId);
                  if (res?.error) toast.error(res.error);
                  else toast.success(`Transcribed — ${res?.cues ?? 0} lines.`);
                })
              }
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hi disabled:opacity-50"
            >
              <IconSparkles size={13} />
              {pending ? "Transcribing…" : "Generate transcript"}
            </button>
          </>
        ) : (
          <p className="max-w-60 text-xs">
            Upload a cut first — then it can be transcribed automatically.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-3">
        <span className="rounded-md bg-panel px-2 py-1 text-[11px] text-ink-2">
          {transcript.language.toUpperCase()} · {transcript.source}
        </span>
        <div className="relative ml-auto flex-1">
          <IconSearch
            size={13}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search transcript"
            className="w-full rounded-md bg-panel py-1.5 pl-7 pr-2 text-xs text-ink placeholder:text-ink-3 focus:outline-none"
          />
        </div>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-4">
        {matches.map((c, i) => {
          const isActive = cues[activeIndex] === c;
          return (
            <div
              key={`${c.start}-${i}`}
              data-start={c.start}
              data-end={c.end}
              onClick={() => onSeek(c.start)}
              className={`cursor-pointer rounded-lg px-2 py-1.5 transition ${
                isActive ? "bg-accent-ghost" : "hover:bg-panel"
              }`}
            >
              <span className="mb-0.5 block font-mono text-[11px] text-ink-3">
                {timecode(c.start)}
              </span>
              <p className={`text-sm leading-relaxed ${isActive ? "text-ink" : "text-ink-2"}`}>
                {c.text}
              </p>
            </div>
          );
        })}
        {matches.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-3">No lines match “{query}”.</p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2.5">
        <button
          type="button"
          onClick={() => void copyAll()}
          className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 hover:bg-hover hover:text-ink"
        >
          Copy
        </button>
        <button
          type="button"
          disabled={!selection}
          onClick={() => {
            if (selection) onCommentRange(selection.start, selection.end);
            window.getSelection()?.removeAllRanges();
            setSelection(null);
          }}
          className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hi disabled:opacity-40"
        >
          {selection
            ? `Comment ${timecode(selection.start)} – ${timecode(selection.end)}`
            : "Select text to comment"}
        </button>
      </div>
    </div>
  );
}
