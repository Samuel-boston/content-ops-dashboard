"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { markAllReadAction, markNotificationReadAction } from "@/app/notification-actions";
import { IconAt, IconX } from "@/components/ui/icons";
import type { AppNotification } from "@/lib/types";

export function NotificationBell({
  items,
  unread,
}: {
  items: AppNotification[];
  unread: number;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  // The panel had no way out: no backdrop, no close button, no Escape. Opening
  // it once left it sitting over the page until you navigated away.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-md px-2 py-1 text-ink-2 hover:bg-hover hover:text-ink"
        aria-label="Notifications"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
        <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-line bg-card shadow-xl">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            <div className="ml-auto flex items-center gap-2 text-xs">
              <button
                onClick={() => markAllReadAction().then(() => router.refresh())}
                className="text-ink-2 hover:text-ink"
              >
                Mark all read
              </button>
              <Link
                href="/notifications?filter=mentions"
                className="text-accent-hi hover:underline"
                onClick={() => setOpen(false)}
              >
                Mentions
              </Link>
              <Link href="/notifications" className="text-accent-hi hover:underline" onClick={() => setOpen(false)}>
                All
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close notifications"
                className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
              >
                <IconX size={13} />
              </button>
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-ink-3">Nothing yet.</p>
            ) : (
              items.map((n) => (
                <Link
                  key={n.id}
                  href={n.link ?? "/"}
                  onClick={() => {
                    markNotificationReadAction(n.id);
                    setOpen(false);
                  }}
                  className={`block border-b border-line/70 px-3 py-2 text-sm hover:bg-hover/50 ${
                    n.read ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {!n.read ? <span className="h-1.5 w-1.5 rounded-full bg-accent" /> : null}
                    {n.kind === "mention" ? (
                      <span className="flex shrink-0 items-center text-accent-hi">
                        <IconAt size={11} />
                      </span>
                    ) : null}
                    <span className="font-medium text-ink">{n.title}</span>
                  </div>
                  {n.body ? <p className="mt-0.5 text-xs text-ink-2">{n.body}</p> : null}
                  <p className="mt-0.5 text-[10px] text-ink-3">
                    {new Date(n.created_at).toLocaleString()}
                  </p>
                </Link>
              ))
            )}
          </div>
        </div>
        </>
      ) : null}
    </div>
  );
}
