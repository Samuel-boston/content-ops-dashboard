"use client";

import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { setStatusAction } from "@/app/actions";
import {
  EDITOR_SETTABLE_STATUSES,
  STATUS_LABELS,
  STATUS_ORDER,
  type Role,
  type VideoStatus,
} from "@/lib/types";

export function StatusSelect({
  videoId,
  current,
  role,
}: {
  videoId: string;
  current: VideoStatus;
  role: Role;
}) {
  const [value, setValue] = useState<VideoStatus>(current);
  const [pending, startTransition] = useTrackedTransition();
  const [error, setError] = useState<string | null>(null);

  const isManager = role === "owner" || role === "admin";

  // Only offer what the person can actually pick. The database guard rejects
  // everything else, so listing those stages just invites an error message —
  // this used to show an editor all twelve and disable two of them.
  // The current stage is always included, even when it's one they can't set,
  // so the select still reads as a truthful label of where the video is.
  const options = isManager
    ? STATUS_ORDER
    : STATUS_ORDER.filter((s) => EDITOR_SETTABLE_STATUSES.includes(s) || s === current);

  return (
    <div className="inline-flex min-w-0 max-w-full flex-col gap-0.5">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as VideoStatus;
          setValue(next);
          setError(null);
          startTransition(async () => {
            const res = await setStatusAction(videoId, next);
            if (res?.error) {
              setError(res.error);
              setValue(current);
            }
          });
        }}
        className="w-full min-w-0 max-w-full truncate rounded-md border border-line-strong bg-raised px-2 py-1 text-xs outline-none focus:border-accent disabled:opacity-50 sm:w-auto"
      >
        {options.map((s) => (
          <option key={s} value={s} disabled={!isManager && !EDITOR_SETTABLE_STATUSES.includes(s)}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      {error ? <span className="text-[11px] text-danger">{error}</span> : null}
    </div>
  );
}
