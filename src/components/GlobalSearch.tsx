"use client";

import { useEffect, useRef, useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { globalSearch } from "@/app/actions";
import { PriorityPill, StatusBadge } from "@/components/badges";
import type { VideoWithEditor } from "@/lib/types";

/** ⌘K / Ctrl-K search across every video the viewer is allowed to see. */
export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<VideoWithEditor[]>([]);
  const [cursor, setCursor] = useState(0);
  const [pending, startTransition] = useTrackedTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 30);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounced search. The state writes happen inside the timeout/transition
  // callback, never synchronously in the effect body.
  useEffect(() => {
    const t = setTimeout(() => {
      startTransition(async () => {
        const q = term.trim();
        setRows(q.length < 2 ? [] : await globalSearch(q));
        setCursor(0);
      });
    }, 180);
    return () => clearTimeout(t);
  }, [term, startTransition]);

  function openPalette() {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 30);
  }

  function closePalette() {
    setOpen(false);
    setTerm("");
    setRows([]);
    setCursor(0);
  }

  function go(v: VideoWithEditor) {
    closePalette();
    router.push(`/videos/${v.id}`);
  }

  return (
    <>
      <button
        onClick={openPalette}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-ink-2 hover:bg-hover hover:text-ink"
        aria-label="Search"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <kbd className="hidden rounded border border-line-strong px-1 font-mono text-[10px] text-ink-3 xl:inline">
          ⌘K
        </kbd>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[90] flex items-start justify-center bg-black/60 px-4 pt-[12vh]"
          onClick={closePalette}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-card shadow-2xl"
          >
            <input
              ref={inputRef}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setCursor((c) => Math.min(rows.length - 1, c + 1));
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setCursor((c) => Math.max(0, c - 1));
                }
                if (e.key === "Enter" && rows[cursor]) go(rows[cursor]);
              }}
              placeholder="Search videos by title or brief…"
              className="w-full bg-transparent px-4 py-3.5 text-sm outline-none placeholder:text-ink-3"
            />
            <div className="max-h-80 overflow-y-auto border-t border-line">
              {term.trim().length < 2 ? (
                <p className="px-4 py-6 text-center text-xs text-ink-3">
                  Type at least two characters.
                </p>
              ) : pending && rows.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-ink-3">Searching…</p>
              ) : rows.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-ink-3">No matches.</p>
              ) : (
                rows.map((v, i) => (
                  <button
                    key={v.id}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => go(v)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                      i === cursor ? "bg-raised" : ""
                    }`}
                  >
                    <PriorityPill priority={v.priority} />
                    <span className="flex-1 truncate">{v.title}</span>
                    <StatusBadge status={v.status} />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
