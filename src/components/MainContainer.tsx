"use client";

import { usePathname } from "next/navigation";
import { useNavTarget } from "@/components/ui/Pending";
import { BoardSkeleton, ListSkeleton, WorkspaceSkeleton } from "@/components/ui/Skeleton";

/** The skeleton that best matches wherever we're heading. */
function skeletonFor(path: string) {
  if (path === "/board") return <BoardSkeleton />;
  // The video workspace, but not its sub-pages, which are ordinary layouts.
  if (/^\/videos\/[^/]+$/.test(path)) return <WorkspaceSkeleton />;
  return <ListSkeleton />;
}

/**
 * Every page gets the standard centred container — except the video workspace,
 * which is a full-bleed three-pane app screen and manages its own scrolling.
 * Kept as a client component so the layout can stay a server component.
 *
 * It also swaps the page for a skeleton the moment a link is clicked. Every
 * route here is server-rendered on demand, so a navigation is a round trip
 * during which Next keeps the *old* page on screen — which reads as the app
 * ignoring you. Route-level `loading.tsx` is the built-in answer and would be
 * neater, but it leaves the page's client components unhydrated on this Next
 * version (see the note in (app)/layout.tsx). Doing it here is plain client
 * rendering: no Suspense boundary, so nothing to leave unresolved.
 */
export function MainContainer({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const navTarget = useNavTarget();

  // Lay out for wherever we're going, so the container doesn't resize twice.
  const shownPath = navTarget ?? pathname;
  const fullBleed = /^\/videos\/[^/]+$/.test(shownPath);

  return (
    <main
      className={
        fullBleed ? "flex-1" : "mx-auto w-full max-w-7xl flex-1 px-3 py-5 sm:px-6 sm:py-6"
      }
    >
      {navTarget ? (
        <div className={fullBleed ? "px-3 py-5 sm:px-6" : undefined}>
          {skeletonFor(navTarget)}
        </div>
      ) : (
        children
      )}
    </main>
  );
}
