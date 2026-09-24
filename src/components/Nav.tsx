"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { signOutAction } from "@/app/actions";
import { NotificationBell } from "@/components/NotificationBell";
import { GlobalSearch } from "@/components/GlobalSearch";
import { NeedsAttentionBell } from "@/components/NeedsAttentionBell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { IconChevronDown, IconComment, IconSettings } from "@/components/ui/icons";
import type { AppNotification, Profile } from "@/lib/types";
import type { StalledVideo } from "@/app/overview-actions";

/**
 * The client's nav. Deliberately no "Ready to Edit" — that's the editors' pool
 * and belongs to them. The client gets their own planning and decision stages
 * instead: Ideation, Scripting, and a single Review list of everything waiting
 * on them.
 */
const MANAGER_LINKS_BEFORE = [
  { href: "/", label: "Overview" },
  { href: "/board", label: "Board" },
];

const MANAGER_LINKS_AFTER = [
  { href: "/calendar", label: "Calendar" },
  { href: "/team", label: "Team" },
  { href: "/analytics", label: "Analytics" },
  { href: "/library/visuals", label: "Library" },
];

/**
 * Content destinations that don't earn a permanent slot in the main bar, but
 * are still places you go to look at real things — not account settings, so
 * they live in their own nav dropdown rather than buried in the user menu
 * next to Sign out.
 */
const MORE_LINKS = [
  { href: "/archive", label: "Archive" },
  { href: "/parked", label: "Later" },
  { href: "/tasks", label: "VA Tasks" },
];

/**
 * No Calendar: an editor works to the ETA they gave, not to the client's
 * posting schedule, and a month-by-month board answers "when is this due"
 * without a second view of the same dates.
 */
const EDITOR_LINKS = [
  { href: "/my-work", label: "My Work" },
  { href: "/editing-bay", label: "Editing Bay" },
  { href: "/library/visuals", label: "Library" },
  { href: "/time-off", label: "Time off" },
];

/**
 * The copywriter lives in the planning half only: ideas in, scripts out — all
 * on one board (Ideation through Ready to Film). The library is there because
 * good scripts get written against footage that actually exists.
 */
const COPYWRITER_LINKS = [
  { href: "/scripting", label: "Board" },
  { href: "/library/visuals", label: "Library" },
  { href: "/time-off", label: "Time off" },
];

/**
 * The VA posts, and can look at the calendar and library — the calendar
 * read-only. Their "Other" tasks sit under Posting on the same page, so
 * they can't be missed behind a separate tab.
 */
const VA_LINKS = [
  { href: "/posting", label: "Posting" },
  { href: "/archive", label: "Archive" },
  { href: "/calendar", label: "Calendar" },
  { href: "/library/visuals", label: "Library" },
  { href: "/time-off", label: "Time off" },
];

/**
 * Inline pending indicator for a nav link — a dot beside the label while the
 * next route is being fetched. The top progress bar says *that* something is
 * loading; this says *which* link you clicked, which matters when the current
 * page stays on screen for the whole round trip.
 */
function LinkPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent align-middle"
    />
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href.startsWith("/library")) return pathname.startsWith("/library");
  return pathname.startsWith(href);
}

/**
 * A nav-bar dropdown, portaled to <body> rather than rendered inline. The row
 * it lives in scrolls horizontally (`overflow-x-auto`), which clips or
 * otherwise fights any absolutely-positioned child trying to escape it —
 * portaling with a position computed from the trigger's own rect sidesteps
 * that entirely. The header is `sticky top-0`, so the trigger's viewport
 * position doesn't change on page scroll — one measurement at open time is
 * enough.
 */
function NavDropdown({
  label,
  active,
  items,
  pathname,
}: {
  label: string;
  active: boolean;
  items: { href: string; label: string }[];
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  function toggle() {
    setOpen((v) => {
      const next = !v;
      if (next && btnRef.current) {
        const r = btnRef.current.getBoundingClientRect();
        setRect({ top: r.bottom + 4, left: r.left });
      }
      return next;
    });
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={`flex items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition ${
          active ? "bg-raised text-ink" : "text-ink-2 hover:bg-hover hover:text-ink"
        }`}
      >
        {label}
        <IconChevronDown size={13} className={`transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && rect
        ? createPortal(
            <>
              <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
              <div
                style={{ top: rect.top, left: rect.left }}
                className="fixed z-40 w-44 overflow-hidden rounded-lg border border-line bg-card py-1 shadow-2xl"
              >
                {items.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    aria-current={isActive(pathname, l.href) ? "page" : undefined}
                    className={`block px-3 py-2 text-sm transition ${
                      isActive(pathname, l.href)
                        ? "bg-raised text-ink"
                        : "text-ink-2 hover:bg-hover hover:text-ink"
                    }`}
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
            </>,
            document.body
          )
        : null}
    </div>
  );
}

export function Nav({
  profile,
  notifications,
  unread,
  unreadMentions,
  branding,
  stalled,
}: {
  profile: Profile;
  notifications: AppNotification[];
  unread: number;
  unreadMentions: number;
  branding: { name: string; logoUrl: string | null };
  stalled: StalledVideo[];
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const isManager = profile.role === "owner" || profile.role === "admin";
  const links = [
    ...(isManager
      ? [...MANAGER_LINKS_BEFORE, ...MANAGER_LINKS_AFTER, ...MORE_LINKS]
      : profile.role === "copywriter"
        ? COPYWRITER_LINKS
        : profile.role === "va"
          ? VA_LINKS
          : EDITOR_LINKS),
  ];
  if (profile.role === "owner") links.push({ href: "/settings", label: "Settings" });
  const inMore = MORE_LINKS.some((l) => isActive(pathname, l.href));

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-app/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:px-6">
        {/* mobile menu button */}
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="-ml-1 rounded-md p-2 text-ink-2 hover:bg-hover hover:text-ink lg:hidden"
          aria-label="Menu"
          aria-expanded={menuOpen}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {menuOpen ? (
              <path d="M18 6 6 18M6 6l12 12" />
            ) : (
              <path d="M3 12h18M3 6h18M3 18h18" />
            )}
          </svg>
        </button>

        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold">
          {branding.logoUrl ? (
            // Plain <img>: the logo lives on Supabase Storage, and routing it
            // through next/image would need a remote pattern for a file that
            // is already small and cached at the CDN.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.logoUrl}
              alt={branding.name}
              className="h-7 w-auto max-w-[120px] object-contain"
            />
          ) : (
            <span className="whitespace-nowrap">{branding.name}</span>
          )}
        </Link>

        {/* desktop links */}
        <nav className="no-scrollbar ml-2 hidden items-center gap-0.5 overflow-x-auto lg:flex">
          {(isManager ? MANAGER_LINKS_BEFORE : links).map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(pathname, l.href) ? "page" : undefined}
              className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition ${
                isActive(pathname, l.href)
                  ? "bg-raised text-ink"
                  : "text-ink-2 hover:bg-hover hover:text-ink"
              }`}
            >
              {l.label}
              <LinkPending />
            </Link>
          ))}

          {isManager
            ? MANAGER_LINKS_AFTER.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={isActive(pathname, l.href) ? "page" : undefined}
                  className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition ${
                    isActive(pathname, l.href)
                      ? "bg-raised text-ink"
                      : "text-ink-2 hover:bg-hover hover:text-ink"
                  }`}
                >
                  {l.label}
                  <LinkPending />
                </Link>
              ))
            : null}

          {isManager ? <NavDropdown label="More" active={inMore} items={MORE_LINKS} pathname={pathname} /> : null}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <GlobalSearch />
          <NeedsAttentionBell stalled={stalled} />
          <Link
            href="/notifications?filter=mentions"
            aria-current={pathname.startsWith("/notifications") ? "page" : undefined}
            className="relative rounded-md px-2 py-1 text-ink-2 hover:bg-hover hover:text-ink"
            aria-label="Chat — mentions across every video"
            title="Chat — mentions across every video"
          >
            <IconComment size={18} />
            {unreadMentions > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                {unreadMentions > 9 ? "9+" : unreadMentions}
              </span>
            ) : null}
          </Link>
          <NotificationBell items={notifications} unread={unread} />
          {profile.role === "owner" ? (
            <Link
              href="/settings"
              aria-current={pathname.startsWith("/settings") ? "page" : undefined}
              className={`rounded-md p-1.5 transition ${
                pathname.startsWith("/settings")
                  ? "bg-raised text-ink"
                  : "text-ink-2 hover:bg-hover hover:text-ink"
              }`}
              aria-label="Settings"
              title="Settings"
            >
              <IconSettings size={18} />
            </Link>
          ) : null}
          <div className="relative">
            <button
              onClick={() => setUserOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-ink-2 hover:bg-hover hover:text-ink"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-raised text-[11px] font-semibold text-ink">
                {(profile.full_name || profile.email).slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden sm:inline">{profile.full_name || profile.email}</span>
            </button>
            {userOpen ? (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setUserOpen(false)} />
                <div className="absolute right-0 z-20 mt-2 w-48 rounded-lg border border-line bg-card py-1 text-sm shadow-xl">
                  <div className="border-b border-line px-3 pb-2 pt-1">
                    <p className="truncate font-medium text-ink">
                      {profile.full_name || profile.email}
                    </p>
                    <p className="text-xs capitalize text-ink-3">{profile.role}</p>
                  </div>
                  {!isManager ? (
                    <Link
                      href="/time-off"
                      onClick={() => setUserOpen(false)}
                      className="block px-3 py-1.5 text-ink-2 hover:bg-hover"
                    >
                      Time off
                    </Link>
                  ) : null}
                  <Link
                    href="/ai-connect"
                    onClick={() => setUserOpen(false)}
                    className="block px-3 py-1.5 text-ink-2 hover:bg-hover"
                  >
                    Connect AI
                  </Link>
                  {profile.role === "owner" ? (
                    <Link
                      href="/settings"
                      onClick={() => setUserOpen(false)}
                      className="block px-3 py-1.5 text-ink-2 hover:bg-hover"
                    >
                      Settings
                    </Link>
                  ) : null}
                  <div className="border-t border-line">
                    <ThemeToggle />
                  </div>
                  <form action={async () => { await signOutAction(); }}>
                    <button className="w-full px-3 py-1.5 text-left text-ink-2 hover:bg-hover">
                      Sign out
                    </button>
                  </form>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* mobile drawer */}
      {menuOpen ? (
        <nav className="border-t border-line bg-app px-3 py-2 lg:hidden">
          <div className="grid grid-cols-2 gap-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setMenuOpen(false)}
                className={`rounded-md px-3 py-2.5 text-sm ${
                  isActive(pathname, l.href)
                    ? "bg-raised text-ink"
                    : "text-ink-2 hover:bg-hover"
                }`}
              >
                {l.label}
                <LinkPending />
              </Link>
            ))}
          </div>
        </nav>
      ) : null}
    </header>
  );
}
