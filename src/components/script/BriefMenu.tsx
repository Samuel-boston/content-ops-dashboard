"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
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

function BriefMenu({ videoId, onClose }: { videoId: string; onClose: () => void }) {
  const [bundle, setBundle] = useState<BriefBundle | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void getBriefBundleAction(videoId).then((b) => {
      if (alive) setBundle(b);
    });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [videoId, onClose]);

  return (
    <div role="dialog" aria-modal aria-label="Editor brief" className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 px-3 py-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-5xl rounded-2xl border border-line bg-app p-4 shadow-2xl">
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
