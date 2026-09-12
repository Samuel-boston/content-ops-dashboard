import Link from "next/link";
import { ACTIVE_STATUSES, STATUS_LABELS, type VideoStatus } from "@/lib/types";

export function StageCountStrip({
  counts,
  postedCount,
}: {
  counts: Record<VideoStatus, number>;
  postedCount?: number;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {ACTIVE_STATUSES.map((s) => (
        <div
          key={s}
          className="flex items-baseline gap-2 rounded-lg border border-line bg-card px-3 py-2"
        >
          <span className="font-mono text-lg font-semibold tabular-nums">{counts[s]}</span>
          <span className="text-xs text-ink-2">{STATUS_LABELS[s]}</span>
        </div>
      ))}
      {typeof postedCount === "number" ? (
        <Link
          href="/calendar"
          className="flex items-baseline gap-2 rounded-lg border border-line bg-card/50 px-3 py-2 text-ink-3 hover:text-ink-2"
        >
          <span className="font-mono text-lg font-semibold tabular-nums">{postedCount}</span>
          <span className="text-xs">Posted (archive)</span>
        </Link>
      ) : null}
    </div>
  );
}
