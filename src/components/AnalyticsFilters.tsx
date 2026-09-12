"use client";

import { useRouter, useSearchParams } from "next/navigation";

export function AnalyticsFilters({ formats }: { formats: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    router.replace(`?${next.toString()}`);
  };
  const cls =
    "rounded-md border border-line-strong bg-raised px-2 py-1.5 text-sm outline-none focus:border-accent";
  return (
    <div className="flex flex-wrap gap-2">
      <select value={params.get("format") ?? ""} onChange={(e) => set("format", e.target.value)} className={cls}>
        <option value="">All formats</option>
        {formats.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-xs text-ink-3">
        From
        <input type="date" value={params.get("from") ?? ""} onChange={(e) => set("from", e.target.value)} className={cls} />
      </label>
      <label className="flex items-center gap-1 text-xs text-ink-3">
        To
        <input type="date" value={params.get("to") ?? ""} onChange={(e) => set("to", e.target.value)} className={cls} />
      </label>
    </div>
  );
}
