"use client";

import { useClientName } from "@/components/ClientName";
import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { IconChevronDown, IconClock, IconComment } from "@/components/ui/icons";
import { claimVideoAction, nudgeAction, setEtaAction } from "@/app/pipeline-actions";
import { NUDGES, type NudgeKind } from "@/lib/nudges";
import type { VideoStatus } from "@/lib/types";

const pad = (n: number) => String(n).padStart(2, "0");

/** Local YYYY-MM-DD for a date `days` from now — what a date input wants. */
function inDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A delivery promise is a day, not a moment — picking an hour is fussy and
 * means different things across time zones. The day picked means "by the end
 * of it", so the stored instant is 23:59 local on that date.
 */
function endOfDayISO(day: string): string {
  return new Date(`${day}T23:59`).toISOString();
}

const PRESETS: { label: string; days: number }[] = [
  { label: "Tomorrow", days: 1 },
  { label: "In 2 days", days: 2 },
  { label: "In 3 days", days: 3 },
  { label: "Next week", days: 7 },
];

/**
 * The claim dialog. Taking work on without saying when it lands is the exact
 * thing this dashboard exists to fix, so the ETA is required — there's no
 * "skip" and the confirm button stays disabled until a date is picked.
 */
export function ClaimDialog({
  open,
  videoId,
  title,
  mode,
  currentEta,
  goToVideo = false,
  onClose,
}: {
  open: boolean;
  videoId: string;
  title: string;
  /** "claim" also assigns the video; "eta" only (re)sets the date. */
  mode: "claim" | "eta";
  currentEta?: string | null;
  /** After a successful claim, open the video instead of staying on the list. */
  goToVideo?: boolean;
  onClose: () => void;
}) {
  const clientName = useClientName();
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();
  const [when, setWhen] = useState(() =>
    currentEta
      ? (() => {
          const d = new Date(currentEta);
          return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        })()
      : ""
  );

  if (!open) return null;

  const submit = () =>
    startTransition(async () => {
      const iso = endOfDayISO(when);
      const res =
        mode === "claim" ? await claimVideoAction(videoId, iso) : await setEtaAction(videoId, iso);
      if (res?.error) toast.error(res.error);
      else {
        toast.success(mode === "claim" ? `Picked up — ${clientName} can see your ETA.` : "ETA updated.");
        onClose();
        if (mode === "claim" && goToVideo) router.push(`/videos/${videoId}`);
        else router.refresh();
      }
    });

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={mode === "claim" ? "Pick up video" : "Set ETA"}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-2xl border border-line bg-card p-6 shadow-2xl"
      >
        <div>
          <h2 className="text-base font-semibold">
            {mode === "claim" ? "Pick this one up" : "Update your ETA"}
          </h2>
          <p className="mt-1 text-sm text-ink-2">
            <span className="text-ink">{title}</span>
          </p>
          <p className="mt-2 text-xs text-ink-3">
            {mode === "claim"
              ? `${clientName} sees this date on their dashboard, so they're not left guessing.`
              : `Changing a date ${clientName} has already seen will notify them.`}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setWhen(inDays(p.days))}
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink"
            >
              {p.label}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Delivering by
          </span>
          <input
            type="date"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="w-full rounded-lg border border-line bg-raised px-3 py-2 [color-scheme:dark] focus:border-accent focus:outline-none"
          />
          <span className="mt-1 block text-[11px] text-ink-3">
            By the end of that day. Not sure? Pick your best guess — you can change it later.
          </span>
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!when || pending}
            onClick={submit}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hi disabled:opacity-40"
          >
            {pending ? "Saving…" : mode === "claim" ? "Take it on" : "Save ETA"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Delivery promise, tinted when it's already gone past. */
export function EtaBadge({
  etaAt,
  stage,
  overdue = false,
  className = "",
}: {
  etaAt: string | null;
  stage?: VideoStatus | null;
  /** Computed in the data layer — see annotateOverdue(). */
  overdue?: boolean;
  className?: string;
}) {
  if (!etaAt) {
    return (
      <span className={`inline-flex items-center gap-1 text-[11px] text-ink-3 ${className}`}>
        <IconClock size={11} />
        No ETA
      </span>
    );
  }
  const d = new Date(etaAt);
  const late = overdue;
  return (
    <span
      title={stage ? `Promised while in ${stage.replace(/_/g, " ")}` : undefined}
      className={`inline-flex items-center gap-1 text-[11px] ${
        late ? "text-danger" : "text-ink-2"
      } ${className}`}
    >
      <IconClock size={11} />
      {late ? "Was due " : "ETA "}
      {d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
    </span>
  );
}

/**
 * One-tap chase. Canned lines rather than a blank box so asking costs nothing
 * and never comes out sounding sharp.
 */
export function NudgeButton({ videoId }: { videoId: string }) {
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTrackedTransition();

  const send = (kind: NudgeKind) =>
    startTransition(async () => {
      const res = await nudgeAction(videoId, kind);
      if (res?.error) toast.error(res.error);
      else {
        toast.success("Sent.");
        setOpen(false);
        router.refresh();
      }
    });

  return (
    <div className="relative">
      <button
        type="button"
        disabled={pending}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50"
      >
        <IconComment size={12} />
        Ask for an update
        <IconChevronDown size={11} />
      </button>
      {open ? (
        <>
          <span className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-1 w-64 rounded-lg border border-line bg-raised py-1 shadow-xl">
            {(Object.keys(NUDGES) as NudgeKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => send(k)}
                className="block w-full px-3 py-2 text-left text-xs text-ink-2 hover:bg-hover hover:text-ink"
              >
                “{NUDGES[k]}”
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
