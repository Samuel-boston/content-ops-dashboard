"use client";

import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { setNotifyModeAction } from "@/app/settings-extra-actions";

const MODES = [
  {
    key: "realtime" as const,
    label: "As it happens",
    hint: "Every mention, assignment and revision, straight away.",
  },
  {
    key: "digest" as const,
    label: "Daily digest",
    hint: "One email a day with everything that moved. Still notified in-app.",
  },
  {
    key: "off" as const,
    label: "In-app only",
    hint: "Nothing by email. The bell still fills up.",
  },
];

/**
 * The fastest way to make someone ignore a tool is to over-notify them, so
 * this is per-person rather than a workspace-wide setting.
 */
export function NotifyPreference({ current }: { current: "realtime" | "digest" | "off" }) {
  const toast = useToast();
  const [mode, setMode] = useState(current);
  const [, startTransition] = useTrackedTransition();

  return (
    <section className="rounded-xl border border-line bg-card p-4">
      <h2 className="text-sm font-semibold">How much do you want to hear?</h2>
      <p className="mt-0.5 text-[11px] text-ink-3">Applies to you only.</p>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => {
              const previous = mode;
              setMode(m.key);
              startTransition(async () => {
                const res = await setNotifyModeAction(m.key);
                if (res?.error) {
                  toast.error(res.error);
                  setMode(previous);
                } else {
                  toast.success("Saved.");
                }
              });
            }}
            aria-pressed={mode === m.key}
            className={`rounded-xl border px-3 py-2.5 text-left transition ${
              mode === m.key
                ? "border-accent bg-accent-ghost"
                : "border-line bg-panel hover:border-line-strong"
            }`}
          >
            <span className="block text-xs font-medium">{m.label}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">{m.hint}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
