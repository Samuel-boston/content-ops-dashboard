"use client";

import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { refreshAllMetricsAction } from "@/app/analytics-actions";

export function RefreshMetricsButton() {
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="text-right">
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await refreshAllMetricsAction();
            setMsg(r?.ok ? `Refreshed ${r.updated}` : (r?.error ?? "Failed"));
            router.refresh();
          })
        }
        className="rounded-md border border-line-strong px-3 py-1.5 text-sm hover:bg-hover disabled:opacity-50"
      >
        {pending ? "Refreshing…" : "Refresh metrics"}
      </button>
      {msg ? <p className="mt-1 text-[11px] text-ink-3">{msg}</p> : null}
    </div>
  );
}
