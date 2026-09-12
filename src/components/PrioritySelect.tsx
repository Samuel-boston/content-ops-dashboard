"use client";

import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { setPriorityAction } from "@/app/actions";
import { PRIORITY_LABELS, PRIORITY_ORDER, type Priority } from "@/lib/types";

export function PrioritySelect({
  videoId,
  current,
}: {
  videoId: string;
  current: Priority;
}) {
  const [value, setValue] = useState<Priority>(current);
  const [pending, startTransition] = useTrackedTransition();
  const [error, setError] = useState<string | null>(null);

  const styles: Record<Priority, string> = {
    urgent: "border-danger/40 bg-danger/10 text-danger",
    high: "border-warn/40 bg-warn/10 text-warn",
    standard: "border-line-strong bg-raised text-ink-2",
  };

  return (
    <div className="inline-flex flex-col gap-0.5">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as Priority;
          setValue(next);
          setError(null);
          startTransition(async () => {
            const res = await setPriorityAction(videoId, next);
            if (res?.error) {
              setError(res.error);
              setValue(current);
            }
          });
        }}
        className={`w-[104px] rounded-md border px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wide outline-none disabled:opacity-50 ${styles[value]}`}
      >
        {PRIORITY_ORDER.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABELS[p]}
          </option>
        ))}
      </select>
      {error ? <span className="text-[11px] text-danger">{error}</span> : null}
    </div>
  );
}
