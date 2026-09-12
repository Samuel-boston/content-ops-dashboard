"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";

export function ArchiveFilters({
  view,
  pillarOptions,
  formatOptions,
  editors,
}: {
  view: "list" | "calendar";
  pillarOptions: string[];
  formatOptions: string[];
  editors: { id: string; name: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTrackedTransition();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`/archive?${next.toString()}`));
  }

  const cls =
    "rounded-md border border-line-strong bg-raised px-2 py-1.5 text-sm outline-none focus:border-accent";

  return (
    <div className={`flex flex-wrap gap-2 ${pending ? "opacity-60" : ""}`}>
      <div className="flex overflow-hidden rounded-md border border-line-strong">
        {(["list", "calendar"] as const).map((v) => (
          <button
            key={v}
            onClick={() => set("view", v === "list" ? "" : v)}
            className={`px-3 py-1.5 text-sm capitalize ${
              view === v ? "bg-hover text-ink" : "bg-card text-ink-2"
            }`}
          >
            {v}
          </button>
        ))}
      </div>
      <input
        defaultValue={params.get("search") ?? ""}
        onChange={(e) => set("search", e.target.value)}
        placeholder="Search title…"
        className={`${cls} min-w-[160px] flex-1`}
      />
      <select value={params.get("format") ?? ""} onChange={(e) => set("format", e.target.value)} className={cls}>
        <option value="">All formats</option>
        {formatOptions.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <select value={params.get("pillar") ?? ""} onChange={(e) => set("pillar", e.target.value)} className={cls}>
        <option value="">All pillars</option>
        {pillarOptions.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <select value={params.get("editor") ?? ""} onChange={(e) => set("editor", e.target.value)} className={cls}>
        <option value="">All editors</option>
        {editors.map((e) => (
          <option key={e.id} value={e.id}>{e.name}</option>
        ))}
      </select>
    </div>
  );
}
