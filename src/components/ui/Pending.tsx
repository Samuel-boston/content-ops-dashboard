"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";

/**
 * Global "something is happening" state.
 *
 * Two things make this app feel slow, and both are the same problem: no
 * immediate response to a click.
 *
 *  - Mutations are a server action followed by `router.refresh()`, which
 *    re-renders the whole route on the server.
 *  - Navigations are a full server render too — every route here is dynamic,
 *    since everything is scoped to who's asking.
 *
 * Either way there's a round trip, and Next holds the current page on screen
 * for its whole duration. Without a signal, a click looks ignored and people
 * click again. Route-level `loading.tsx` would be the idiomatic fix but breaks
 * hydration on this Next version — see the note in (app)/layout.tsx — so the
 * feedback is a progress bar driven from here instead.
 *
 * The count lives outside React because that's what it is: a number several
 * unrelated components mutate. Holding it in component state meant writing to
 * state from inside an effect, which is the cascade React's lint rule warns
 * about.
 */
let inFlight = 0;
/** The path being navigated to, or null when we're settled. */
let navTarget: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** One boolean out of two sources, so the bar has a single input. */
const getBarSnapshot = () => inFlight > 0 || navTarget !== null;
/** Nothing is ever in flight during the server render. */
const getFalse = () => false;

const getNavSnapshot = () => navTarget;
const getNullSnapshot = () => null;

/**
 * Where we're navigating to, or null.
 *
 * The page area uses this to swap in a skeleton the instant a link is clicked,
 * which is the part that makes the app feel responsive: route-level
 * `loading.tsx` would do it natively but breaks hydration on this Next version
 * (see (app)/layout.tsx), so it's done here in client-land instead — no
 * Suspense boundary, no hydration risk.
 */
export function useNavTarget() {
  return useSyncExternalStore(subscribe, getNavSnapshot, getNullSnapshot);
}

export function PendingProvider({ children }: { children: React.ReactNode }) {
  const active = useSyncExternalStore(subscribe, getBarSnapshot, getFalse);
  return (
    <>
      <NavigationWatcher />
      <GlobalProgress active={active} />
      {children}
    </>
  );
}

/**
 * `useTransition`, but the pending state is also reported to the app shell.
 *
 * A drop-in replacement: same tuple, same semantics. Components that want a
 * local spinner can still read the first element; those that don't at least
 * contribute to the progress bar.
 */
export function useTrackedTransition() {
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!pending) return;
    inFlight += 1;
    emit();
    return () => {
      inFlight = Math.max(0, inFlight - 1);
      emit();
    };
  }, [pending]);

  return [pending, startTransition] as const;
}

/**
 * Turns a click on any internal link into immediate feedback.
 *
 * Done at the document level rather than per-`<Link>` on purpose: it covers
 * the nav, board cards, video rows and every other link in the app without
 * each one having to opt in, and it can't be forgotten when someone adds a
 * new link. The bar clears when the pathname actually changes.
 */
function NavigationWatcher() {
  const pathname = usePathname();

  // Arrived somewhere new — whatever we were waiting for has landed.
  useEffect(() => {
    if (navTarget === null) return;
    navTarget = null;
    emit();
  }, [pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // Anything the browser handles itself: new tab, download, modified click.
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      // Internal, and actually going somewhere else.
      if (!href?.startsWith("/") || href.startsWith("//")) return;
      if (href.split(/[?#]/)[0] === pathname) return;

      navTarget = href.split(/[?#]/)[0];
      emit();
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname]);

  // A navigation that never completes (a redirect back to where we were, or a
  // failure) would otherwise leave the bar running forever.
  useEffect(() => {
    if (navTarget === null) return;
    const bail = setTimeout(() => {
      navTarget = null;
      emit();
    }, 15000);
    return () => clearTimeout(bail);
  }, [pathname]);

  return null;
}

/**
 * A slim bar across the top of the viewport.
 *
 * It creeps toward 90% rather than tracking real progress — there is no
 * progress to track, only a request that hasn't come back yet — then snaps to
 * full and fades. The short delay before it appears keeps quick actions from
 * flashing it, which is worse than showing nothing at all.
 */
function GlobalProgress({ active }: { active: boolean }) {
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!active) {
      // Both deferred by a tick: setting state straight from an effect body
      // is the cascading-render pattern React's lint rule flags, and there's
      // nothing here that needs to happen before the browser paints.
      const snap = setTimeout(() => setWidth((w) => (w > 0 ? 100 : 0)), 0);
      const done = setTimeout(() => {
        setVisible(false);
        setWidth(0);
      }, 220);
      return () => {
        clearTimeout(snap);
        clearTimeout(done);
      };
    }

    // Short enough to read as instant, long enough that a fast action doesn't
    // flash a bar at you.
    const appear = setTimeout(() => {
      setVisible(true);
      setWidth(15);
    }, 80);

    const creep = setInterval(() => {
      setWidth((w) => (w >= 90 ? w : w + Math.max(0.5, (90 - w) / 12)));
    }, 160);

    return () => {
      clearTimeout(appear);
      clearInterval(creep);
    };
  }, [active]);

  const style = useMemo(
    () => ({ width: `${width}%`, opacity: visible ? 1 : 0 }),
    [width, visible]
  );

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-[3px]">
      <div
        className="h-full rounded-r-full bg-accent shadow-[0_0_10px_var(--color-accent)] transition-[width,opacity] duration-200 ease-out"
        style={style}
      />
    </div>
  );
}
