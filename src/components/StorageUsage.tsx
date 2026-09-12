import { fileSize, money, STORAGE_RATES, storageCost } from "@/lib/format";
import type { BucketUsage } from "@/app/settings-extra-actions";

const LABELS: Record<string, { name: string; note: string }> = {
  footage: { name: "Raw footage", note: "Swept to Drive when a video is posted." },
  music: { name: "Music library", note: "Stays here permanently." },
  references: { name: "References", note: "Auto-archived after 30 days." },
  "comment-media": { name: "Voice notes & attachments", note: "Small, stays with the comment." },
};

/**
 * What's actually using space. Raw footage is the only line that ever gets
 * big — everything else is rounding error — so it's worth being able to see
 * it before the storage bill does.
 */
export function StorageUsage({ usage }: { usage: BucketUsage[] }) {
  const total = usage.reduce((n, u) => n + u.bytes, 0);
  const max = Math.max(1, ...usage.map((u) => u.bytes));
  const cost = storageCost(total);
  const pct = Math.min(100, cost.usedFraction * 100);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Storage</h2>
        <p className="text-[11px] text-ink-3">
          {fileSize(total)} across {usage.reduce((n, u) => n + u.files, 0)} files.
        </p>
      </div>

      {/* The running cost, stated rather than assumed. You asked to keep this
          to a minimum, which only means anything if it's visible. */}
      <div className="rounded-xl border border-line bg-card p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[11px] uppercase tracking-wider text-ink-3">Costing you</span>
          <span className="text-2xl font-semibold tabular-nums">
            {cost.monthlyCents === 0 ? "$0" : money(cost.monthlyCents)}
          </span>
          <span className="text-xs text-ink-2">/ month for storage</span>
        </div>

        <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-panel">
          <div
            className={`h-full rounded-full ${pct > 85 ? "bg-warn" : "bg-ok"}`}
            style={{ width: `${Math.max(0.5, pct)}%` }}
          />
        </div>

        <p className="mt-2 text-[11px] leading-snug text-ink-3">
          {cost.monthlyCents === 0 ? (
            <>
              Using {fileSize(total)} of the {fileSize(STORAGE_RATES.includedBytes)} included on
              Supabase Pro &mdash; {pct < 1 ? "well under" : `${pct.toFixed(0)}% of`} the allowance,
              so storage costs nothing yet.
            </>
          ) : (
            <>
              {cost.overageGb.toFixed(1)} GB past the {fileSize(STORAGE_RATES.includedBytes)}{" "}
              included, at ${(STORAGE_RATES.perGbCents / 100).toFixed(3)}/GB/month.
            </>
          )}{" "}
          Raw footage is the only line that grows; posting a video sweeps it to Drive and clears it.
        </p>
      </div>

      <div className="space-y-2">
        {usage.map((u) => (
          <div key={u.bucket} className="rounded-xl border border-line bg-card p-3">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium">{LABELS[u.bucket]?.name ?? u.bucket}</span>
              <span className="ml-auto text-xs tabular-nums text-ink-2">
                {u.truncated ? "over " : ""}
                {fileSize(u.bytes)}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.max(1, (u.bytes / max) * 100)}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-ink-3">
              {u.files} file{u.files === 1 ? "" : "s"} · {LABELS[u.bucket]?.note ?? ""}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
