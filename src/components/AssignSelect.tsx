"use client";

import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { assignEditorAction } from "@/app/actions";
import { ClaimDialog } from "@/components/pipeline/Eta";
import type { Profile } from "@/lib/types";

interface Props {
  videoId: string;
  videoTitle?: string;
  currentEditorId: string | null;
  currentEditorName: string | null;
  editors: Pick<Profile, "id" | "full_name" | "email">[];
  /** Owner/Admin can assign anyone; an editor can only pick/drop themselves. */
  canAssignOthers: boolean;
  meId: string;
  /** Existing ETA, if any — an editor re-picking their own work keeps it. */
  currentEta?: string | null;
}

export function AssignSelect({
  videoId,
  videoTitle = "this video",
  currentEditorId,
  currentEditorName,
  editors,
  canAssignOthers,
  meId,
  currentEta = null,
}: Props) {
  const [pending, startTransition] = useTrackedTransition();
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState(currentEditorId ?? "");
  const [claiming, setClaiming] = useState(false);
  const router = useRouter();

  const selectable = canAssignOthers ? editors : editors.filter((e) => e.id === meId);
  const isSet = Boolean(value);

  function onChange(next: string) {
    setError(null);

    // An editor taking work on owes the client a delivery date, so route that
    // through the claim dialog rather than assigning silently. Managers handing
    // work out, and anyone unassigning, keep the plain path.
    if (next === meId && !canAssignOthers && next !== currentEditorId) {
      setClaiming(true);
      return;
    }

    setValue(next);
    startTransition(async () => {
      const res = await assignEditorAction(videoId, next || null);
      if (res?.error) {
        setError(res.error);
        setValue(currentEditorId ?? "");
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="inline-flex flex-col items-start gap-0.5">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        className={`rounded-md border px-2 py-1 text-xs outline-none disabled:opacity-50 ${
          isSet
            ? "border-accent bg-accent-ghost text-accent-hi"
            : "border-line-strong bg-raised text-ink-2"
        }`}
      >
        <option value="">Unassigned</option>
        {/* keep the current editor visible even if they're no longer selectable */}
        {currentEditorId && !selectable.some((e) => e.id === currentEditorId) ? (
          <option value={currentEditorId}>{currentEditorName ?? "Current editor"}</option>
        ) : null}
        {selectable.map((e) => (
          <option key={e.id} value={e.id}>
            {e.id === meId ? `${e.full_name || e.email} (me)` : e.full_name || e.email}
          </option>
        ))}
      </select>
      {error ? <span className="text-[11px] text-danger">{error}</span> : null}

      <ClaimDialog
        open={claiming}
        mode="claim"
        videoId={videoId}
        title={videoTitle}
        currentEta={currentEta}
        onClose={() => setClaiming(false)}
      />
    </div>
  );
}
