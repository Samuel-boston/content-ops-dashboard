"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { AndreasChat } from "@/components/andreas/AndreasChat";
import { useAndreas } from "@/components/andreas/AndreasProvider";
import { IconFullscreen, IconSparkles, IconX } from "@/components/ui/icons";

/**
 * Andreas, reachable from anywhere — a circular launcher docked to the side
 * like a live-chat widget, not a nav item you have to navigate away to use.
 * Opens a wide panel over the current page rather than replacing it, since
 * the whole point is asking about a video without losing your place. "Full
 * screen" is the one honest way out of that trade-off: the dedicated /andreas
 * page, for when the panel really is too small for what you're doing.
 *
 * Open/close state lives in AndreasProvider, not here, so other parts of the
 * app (the Overview page's own "ask" box) can open this same panel with a
 * question already in hand.
 */
export function AndreasFab() {
  const pathname = usePathname();
  const { open, autoAsk, openWith, close } = useAndreas();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // The full-screen page IS this, at full size — a launcher on top of it
  // would just open a smaller copy of the page already on screen.
  if (pathname.startsWith("/andreas")) return null;

  return (
    <>
      <button
        onClick={() => openWith()}
        aria-label="Ask Andreas"
        title="Ask Andreas — about a video, a list, or top performers"
        className={`fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-2xl transition hover:bg-accent-hi hover:scale-105 ${
          open ? "pointer-events-none scale-90 opacity-0" : ""
        }`}
      >
        <IconSparkles size={22} />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={close} />
          <div className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-card shadow-2xl sm:w-[45vw] sm:min-w-[420px] sm:max-w-[640px]">
            <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-ghost text-accent-hi">
                <IconSparkles size={15} />
              </span>
              <h2 className="text-sm font-semibold">Ask Andreas</h2>
              <Link
                href="/andreas"
                onClick={close}
                aria-label="Open full screen"
                title="Open full screen"
                className="ml-auto rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-ink"
              >
                <IconFullscreen size={15} />
              </Link>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-ink"
              >
                <IconX size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 p-4">
              <AndreasChat autoAsk={autoAsk} />
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
