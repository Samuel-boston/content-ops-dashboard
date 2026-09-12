import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listMyNotifications } from "@/app/notification-actions";
import { MarkAllRead } from "@/components/MarkAllRead";
import { NotifyPreference } from "@/components/NotifyPreference";
import { IconAt } from "@/components/ui/icons";

/**
 * Mentions get their own tab — deliberately, per the client's ask: someone
 * tagging you by name in a chat or a comment is a different kind of urgent
 * than "your video was assigned" or "a client left a note", and it was
 * getting lost in one flat list of everything.
 */
export default async function NotificationsPage({
  searchParams,
}: PageProps<"/notifications">) {
  const viewer = await requireUser();
  const sp = await searchParams;
  const filter = sp.filter === "mentions" ? "mentions" : "all";

  const all = await listMyNotifications(100);
  const mentions = all.filter((n) => n.kind === "mention");
  const items = filter === "mentions" ? mentions : all;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Notifications</h1>
        <MarkAllRead />
      </div>

      <NotifyPreference current={viewer.notify_mode ?? "realtime"} />

      <div className="flex items-center gap-1 border-b border-line">
        <Link
          href="/notifications"
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
            filter === "all"
              ? "border-accent text-ink"
              : "border-transparent text-ink-3 hover:text-ink-2"
          }`}
        >
          All
          <span className="text-xs text-ink-3">{all.length}</span>
        </Link>
        <Link
          href="/notifications?filter=mentions"
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
            filter === "mentions"
              ? "border-accent text-ink"
              : "border-transparent text-ink-3 hover:text-ink-2"
          }`}
        >
          <IconAt size={13} />
          Mentions
          <span className="text-xs text-ink-3">{mentions.length}</span>
        </Link>
      </div>

      <div className="rounded-xl border border-line bg-app overflow-hidden">
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-3">
            {filter === "mentions" ? "No one's tagged you yet." : "Nothing yet."}
          </p>
        ) : (
          items.map((n) => (
            <Link
              key={n.id}
              href={n.link ?? "/"}
              className={`block border-b border-line px-4 py-3 last:border-0 hover:bg-hover/50 ${
                n.read ? "opacity-60" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                {!n.read ? <span className="h-1.5 w-1.5 rounded-full bg-accent" /> : null}
                {n.kind === "mention" ? (
                  <span className="flex items-center gap-0.5 rounded bg-accent/15 px-1 py-0.5 text-[10px] font-medium text-accent-hi">
                    <IconAt size={10} />
                    mention
                  </span>
                ) : null}
                <span className="font-medium">{n.title}</span>
                <span className="ml-auto text-xs text-ink-3">
                  {new Date(n.created_at).toLocaleString()}
                </span>
              </div>
              {n.body ? <p className="mt-1 text-sm text-ink-2">{n.body}</p> : null}
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
