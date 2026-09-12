import {
  PRIORITY_LABELS,
  STATUS_COLOR,
  STATUS_LABELS,
  type Priority,
  type VideoStatus,
} from "@/lib/types";

/**
 * Tinted from the single STATUS_COLOR map rather than a parallel style table,
 * so adding a stage can't leave the badge out of sync with the board rails.
 */
export function StatusBadge({ status }: { status: VideoStatus }) {
  const colour = STATUS_COLOR[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium"
      style={{
        color: colour,
        borderColor: `color-mix(in srgb, ${colour} 40%, transparent)`,
        background: `color-mix(in srgb, ${colour} 12%, transparent)`,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: colour }} />
      {STATUS_LABELS[status]}
    </span>
  );
}

const PRIORITY_STYLES: Record<Priority, string> = {
  urgent: "bg-danger/10 text-danger border-danger/40",
  high: "bg-warn/10 text-warn border-warn/40",
  standard: "bg-raised text-ink-2 border-line-strong",
};

export function PriorityPill({ priority }: { priority: Priority }) {
  return (
    <span
      className={`inline-flex w-[68px] justify-center items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${PRIORITY_STYLES[priority]}`}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

export function StalledFlag() {
  return (
    <span
      title="This video has been sitting in one stage longer than expected"
      className="inline-flex items-center gap-1 rounded-md border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-[11px] font-medium text-danger"
    >
      ⚠ Stalled
    </span>
  );
}

export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-line-strong bg-raised/60 px-1.5 py-0.5 text-[11px] text-ink-2">
      {children}
    </span>
  );
}
