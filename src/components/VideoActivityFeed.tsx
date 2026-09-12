import type { VideoActivity } from "@/lib/types";

const ICONS: Record<string, string> = {
  status: "→",
  assignment: "◉",
  priority: "!",
  version: "▲",
  comment: "”",
  publish: "↗",
};

/** A short audit trail so "what happened to this video" doesn't live in chat. */
export function VideoActivityFeed({ items }: { items: VideoActivity[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-line bg-app p-4">
      <h3 className="mb-3 text-sm font-semibold text-ink-2">Activity</h3>
      <ol className="space-y-2">
        {items.map((a) => (
          <li key={a.id} className="flex gap-2 text-xs">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-raised font-mono text-[10px] text-ink-2">
              {ICONS[a.kind] ?? "·"}
            </span>
            <span className="flex-1 text-ink-2">
              {a.summary}
              {a.actor ? (
                <span className="text-ink-3">
                  {" "}
                  — {a.actor.full_name || a.actor.email}
                </span>
              ) : null}
            </span>
            <span className="shrink-0 text-ink-3">
              {new Date(a.created_at).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
