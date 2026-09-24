import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { AndreasFab } from "@/components/andreas/AndreasFab";
import { AndreasProvider } from "@/components/andreas/AndreasProvider";
import { MainContainer } from "@/components/MainContainer";
import { ToastProvider } from "@/components/ui/Toast";
import { PendingProvider } from "@/components/ui/Pending";
import { listMyNotifications, unreadCount, unreadMentionCount } from "@/app/notification-actions";
import { listStalledOverdue, listMyStalledOverdue } from "@/app/overview-actions";
import { brandingFor, getClientName } from "@/lib/workspace";
import { ClientNameProvider } from "@/components/ClientName";

// Every authed route reads the session cookie, so it's dynamic regardless —
// this just makes it explicit and guarantees nothing here is ever cached.
export const dynamic = "force-dynamic";

// NOTE: deliberately no `loading.tsx` anywhere under (app), and this has now
// been verified twice. On Next 16.3.2 a route-level loading file leaves the
// page's Suspense boundary unresolved on the client in a production build: the
// layout hydrates but the page's own client components never do, so selects,
// dialogs and players render as dead HTML.
//
// Re-tested 5 Sep 2026 by adding (app)/loading.tsx and rebuilding. Checking for
// a React fiber key on a page button gave layoutHydrated=true,
// pageHydrated=false; removing the file again restored both. A shallower check
// (does a dialog open on one route) passed and hid the bug — verify hydration
// per route, not per click.
//
// Navigation feedback comes from the top progress bar instead: see
// components/ui/Pending.tsx, which watches internal link clicks directly.

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireUser();
  const isManager = profile.role === "owner" || profile.role === "admin";
  const [notifications, unread, unreadMentions, branding, stalled, clientName] = await Promise.all([
    listMyNotifications(15),
    unreadCount(),
    unreadMentionCount(),
    brandingFor(),
    isManager ? listStalledOverdue() : profile.role === "editor" ? listMyStalledOverdue() : Promise.resolve([]),
    getClientName(),
  ]);
  return (
    <ToastProvider>
      <ClientNameProvider name={clientName}>
      <PendingProvider>
      <AndreasProvider>
      <div className="flex min-h-screen flex-col">
        <Nav
          profile={profile}
          notifications={notifications}
          unread={unread}
          unreadMentions={unreadMentions}
          branding={branding}
          stalled={stalled}
        />
        <MainContainer>{children}</MainContainer>
        {isManager ? <AndreasFab /> : null}
      </div>
      </AndreasProvider>
      </PendingProvider>
      </ClientNameProvider>
    </ToastProvider>
  );
}
