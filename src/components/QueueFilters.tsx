"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { CONTENT_PILLARS, FORMATS, PLATFORMS } from "@/lib/taxonomy";

export function QueueFilters({
  pillarOptions = CONTENT_PILLARS as unknown as string[],
  formatOptions = FORMATS as unknown as string[],
  platformOptions = PLATFORMS as unknown as string[],
}: {
  pillarOptions?: string[];
  formatOptions?: string[];
  platformOptions?: string[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTrackedTransition();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    startTransition(() => router.replace(`?${next.toString()}`));
  }

  const selectCls =
    "rounded-md border border-line-strong bg-raised px-2 py-1.5 text-sm outline-none focus:border-accent";

  return (
    <div className={`flex flex-wrap gap-2 ${pending ? "opacity-60" : ""}`}>
      <input
        defaultValue={params.get("search") ?? ""}
        onChange={(e) => set("search", e.target.value)}
        placeholder="Search title…"
        className={`${selectCls} min-w-[200px] flex-1`}
      />
      <select value={params.get("pillar") ?? ""} onChange={(e) => set("pillar", e.target.value)} className={selectCls}>
        <option value="">All pillars</option>
        {pillarOptions.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <select value={params.get("format") ?? ""} onChange={(e) => set("format", e.target.value)} className={selectCls}>
        <option value="">All formats</option>
        {formatOptions.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <select value={params.get("platform") ?? ""} onChange={(e) => set("platform", e.target.value)} className={selectCls}>
        <option value="">All platforms</option>
        {platformOptions.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}
