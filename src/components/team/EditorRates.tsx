"use client";

import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { setEditorRateAction, setHookSurchargeAction } from "@/app/pricing-actions";
import type { EditorRate } from "@/lib/types";

function toMajor(cents: number) {
  return (cents / 100).toFixed(2);
}

/**
 * Per-format rates for one editor, plus the shared hook-variant surcharge.
 * Owner-only — RLS refuses the write for anyone else, this just doesn't render
 * the inputs.
 */
export function EditorRates({
  editorId,
  formats,
  rates,
  surchargeCents,
  currency,
  canEdit,
}: {
  editorId: string;
  formats: string[];
  rates: EditorRate[];
  surchargeCents: number;
  currency: string;
  canEdit: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [, startTransition] = useTrackedTransition();
  const [surcharge, setSurcharge] = useState(toMajor(surchargeCents));

  const byFormat = new Map(rates.map((r) => [r.format, r.price_cents]));
  const symbol = currency === "GBP" ? "£" : currency === "EUR" ? "€" : "$";

  const save = (format: string, value: string) => {
    const major = Number(value);
    if (!Number.isFinite(major) || major < 0) {
      toast.error("Enter a number.");
      return;
    }
    const cents = Math.round(major * 100);
    if (cents === (byFormat.get(format) ?? 0)) return;
    startTransition(async () => {
      const res = await setEditorRateAction(editorId, format, cents);
      if (res?.error) toast.error(res.error);
      else router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-line bg-card">
        {formats.map((f) => (
          <div
            key={f}
            className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-0"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{f}</span>
            <span className="text-xs text-ink-3">{symbol}</span>
            {canEdit ? (
              <input
                type="number"
                min={0}
                step="0.01"
                defaultValue={toMajor(byFormat.get(f) ?? 0)}
                onBlur={(e) => save(f, e.target.value)}
                className="w-24 rounded-md border border-line bg-raised px-2 py-1 text-right text-sm tabular-nums focus:border-accent focus:outline-none"
              />
            ) : (
              <span className="w-24 text-right text-sm tabular-nums">
                {toMajor(byFormat.get(f) ?? 0)}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card px-3 py-2.5">
        <span className="min-w-0 flex-1 text-sm text-ink-2">
          Each hook variant after the first
        </span>
        <span className="text-xs text-ink-3">{symbol}</span>
        {canEdit ? (
          <input
            type="number"
            min={0}
            step="0.01"
            value={surcharge}
            onChange={(e) => setSurcharge(e.target.value)}
            onBlur={() =>
              startTransition(async () => {
                const res = await setHookSurchargeAction(Math.round(Number(surcharge) * 100));
                if (res?.error) toast.error(res.error);
                else router.refresh();
              })
            }
            className="w-24 rounded-md border border-line bg-raised px-2 py-1 text-right text-sm tabular-nums focus:border-accent focus:outline-none"
          />
        ) : (
          <span className="w-24 text-right text-sm tabular-nums">{toMajor(surchargeCents)}</span>
        )}
      </div>

      <p className="text-xs leading-relaxed text-ink-3">
        A video is priced at its format rate plus the surcharge for every hook variant beyond the
        first — so 4 variants adds 3 × {symbol}
        {toMajor(surchargeCents)}. The price is locked in when the video is posted, so changing a
        rate here never rewrites what&rsquo;s already been earned.
      </p>
    </div>
  );
}
