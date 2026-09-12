import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { STATUS_LABELS, type VideoStatus } from "@/lib/types";
import { displayName } from "@/lib/format";
import type { WhatsNew as WhatsNewData } from "@/app/overview-actions";

/** "12 minutes ago", "3 days ago". Relative reads better than a timestamp here. */
function ago(iso: string, now: number): string {
  const mins = Math.round((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * Stage moves arrive as "Moved approved → ready_to_post", which is the machine's
 * phrasing. Rewrite to the labels used everywhere else in the product.
 */
function humanise(kind: string, summary: string): string {
  const move = summary.match(/^Moved (\w+) → (\w+)$/);
  if (kind === "status" && move) {
    const to = STATUS_LABELS[move[2] as VideoStatus] ?? move[2];
    const from = STATUS_LABELS[move[1] as VideoStatus] ?? move[1];
    return `${from} → ${to}`;
  }
  return summary;
}

/**
 * Everything that moved while you weren't looking.
 *
 * The bell is a queue of things addressed *to* you; this is the state of the
 * work regardless of whether anyone tagged you. Your own actions are filtered
 * out server-side — nobody needs telling what they just did.
 */
export function WhatsNew({
  data,
  bare = false,
}: {
  data: WhatsNewData;
  /** Skip the card border/background — for when a parent (the Overview report) already provides one. */
  bare?: boolean;
}) {
  // `data.now` is stamped when the rows are fetched rather than read here:
  // calling the clock during render is impure and drifts on hydration.
  const now = data.now;

  return (
    <section className={bare ? "" : "rounded-xl border border-line bg-card p-4"}>
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          What&rsquo;s new
        </h2>
        <span className="text-[11px] text-ink-3">
          {data.since ? `since ${ago(data.since, now)}` : "in the last day"}
        </span>
      </div>

      {data.items.length === 0 ? (
        <p className="py-4 text-center text-xs text-ink-3">
          Nothing has moved since you were last here.
        </p>
      ) : (
        <div className="space-y-0.5">
          {data.items.map((a) => (
            <Link
              key={a.id}
              href={`/videos/${a.video_id}`}
              className="flex items-start gap-2.5 rounded-lg px-2 py-2 transition hover:bg-hover"
            >
              {a.actor ? (
                <span className="mt-0.5 shrink-0">
                  <Avatar person={a.actor} size="xs" />
                </span>
              ) : (
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-line-strong" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">
                  {a.video_title ?? "A video"}
                </span>
                <span className="block truncate text-[11px] text-ink-3">
                  {a.actor ? `${displayName(a.actor)} · ` : ""}
                  {humanise(a.kind, a.summary)}
                </span>
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-ink-3">
                {ago(a.created_at, now)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
