"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getBriefBundleAction, type BriefBundle } from "@/app/brief-actions";
import { EditorBriefWorkspace } from "@/components/script/EditorBriefWorkspace";
import { IconX } from "@/components/ui/icons";

/** The stages that pop the brief menu open: the brief is finished on the way into either. */
export const BRIEF_STAGES = ["ready_to_film", "ready_to_edit"] as const;
export const opensBriefMenu = (status: string) => (BRIEF_STAGES as readonly string[]).includes(status);

const Ctx = createContext<{ open: (videoId: string) => void }>({ open: () => undefined });

/** Call `open(videoId)` after a video is moved into Ready to Film or Ready to Edit. */
export const useBriefMenu = () => useContext(Ctx);

/**
 * The editor brief is not a stage any more: it is a menu. It lives in the layout
 * so it survives the page change that usually follows a move, and shows the whole
 * brief (voice note, written brief, screen recording, references, track, priority)
 * to fill in or skip. Nothing blocks the move — the video is already where you sent it.
 */
export function BriefMenuProvider({ children }: { children: React.ReactNode }) {
  const [videoId, setVideoId] = useState<string | null>(null);
  const open = useCallback((id: string) => setVideoId(id), []);
  const close = useCallback(() => setVideoId(null), []);
  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {videoId ? <BriefMenu key={videoId} videoId={videoId} onClose={close} /> : null}
    </Ctx.Provider>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function BriefMenu({ videoId, onClose }: { videoId: string; onClose: () => void }) {
  const [bundle, setBundle] = useState<BriefBundle | null | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    let alive = true;
    void getBriefBundleAction(videoId).then((b) => {
      if (alive) setBundle(b);
    });
    return () => {
      alive = false;
    };
  }, [videoId]);

  // Keyboard, focus and scroll behave like a real dialog: Escape only closes this one when
  // nothing is open on top of it (an image picker, the slide designer), Tab stays inside,
  // the page behind doesn't scroll, and focus goes back to where it was.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const scrollY = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    root.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const box = root.current;
      if (!box) return;
      if (e.key === "Escape") {
        if (e.defaultPrevented) return;
        const overlays = Array.from(document.querySelectorAll<HTMLElement>("div.fixed.inset-0, [aria-modal='true']"));
        if (overlays.some((o) => o !== box)) return;
        onClose();
      } else if (e.key === "Tab") {
        const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === box)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = scrollY;
      before?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal
      aria-label="Editor brief"
      tabIndex={-1}
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 px-3 py-6 outline-none"
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // Only a click that started and ended on the backdrop closes it — not a text selection dragged out of the panel.
        if (downOnBackdrop.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-5xl rounded-2xl border border-line bg-app p-4 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-base font-semibold">Editor brief</h2>
          <span className="text-xs text-ink-3">Fill in what the editors need, or skip it — it saves as you go.</span>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto rounded p-1 text-ink-3 hover:bg-hover hover:text-ink">
            <IconX size={15} />
          </button>
        </div>
        {bundle === undefined ? (
          <p className="py-10 text-center text-sm text-ink-3">Loading…</p>
        ) : bundle === null ? (
          <p className="py-10 text-center text-sm text-ink-3">Couldn&rsquo;t open that video.</p>
        ) : (
          <EditorBriefWorkspace {...bundle} embedded onDone={onClose} />
        )}
      </div>
    </div>
  );
}
