"use client";

import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { addTaxonomyOptionAction } from "@/app/actions";
import { TAXONOMY_LABELS, taxonomyOptions, type TaxonomyKind } from "@/lib/taxonomy";

interface Props {
  kind: TaxonomyKind;
  selected: string[];
  customs: string[];
  onChange: (next: string[]) => void;
  /** "lg" for a field that decides how the video functions (format at creation) — big tiles, not small chips. */
  size?: "sm" | "lg";
}

export function TaxonomyMultiSelect({ kind, selected, customs, onChange, size = "sm" }: Props) {
  const [localCustoms, setLocalCustoms] = useState(customs);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [, startTransition] = useTrackedTransition();

  const options = taxonomyOptions(kind, localCustoms, selected);

  function toggle(value: string) {
    onChange(
      selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]
    );
  }

  function commitCustom() {
    const v = draft.trim();
    setDraft("");
    setAdding(false);
    if (!v) return;
    if (!localCustoms.includes(v)) setLocalCustoms((c) => [...c, v]);
    if (!selected.includes(v)) onChange([...selected, v]);
    startTransition(() => {
      addTaxonomyOptionAction(kind, v);
    });
  }

  if (size === "lg") {
    return (
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-ink">{TAXONOMY_LABELS[kind]}</label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {options.map((o) => {
            const on = selected.includes(o);
            return (
              <button
                key={o}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(o)}
                className={`rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition ${
                  on
                    ? "border-accent bg-accent-ghost text-accent-hi"
                    : "border-line bg-raised text-ink-2 hover:border-line-strong hover:text-ink"
                }`}
              >
                {o}
              </button>
            );
          })}

          {adding ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitCustom}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitCustom();
                }
                if (e.key === "Escape") {
                  setDraft("");
                  setAdding(false);
                }
              }}
              placeholder="new value…"
              className="rounded-xl border border-line-strong bg-raised px-3 py-2.5 text-sm outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="rounded-xl border border-dashed border-line-strong px-3 py-2.5 text-left text-sm text-ink-3 hover:text-ink-2"
            >
              + Add your own
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
        {TAXONOMY_LABELS[kind]}
      </label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => toggle(o)}
              className={`rounded-md border px-2 py-1 text-xs transition ${
                on
                  ? "border-accent bg-accent-ghost text-accent-hi"
                  : "border-line bg-card text-ink-2 hover:border-line-strong hover:text-ink"
              }`}
            >
              {o}
            </button>
          );
        })}

        {adding ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitCustom}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitCustom();
              }
              if (e.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
            placeholder="new value…"
            className="w-32 rounded-md border border-line-strong bg-card px-2 py-1 text-xs outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-md border border-dashed border-line-strong px-2 py-1 text-xs text-ink-3 hover:text-ink-2"
          >
            + add your own
          </button>
        )}
      </div>
    </div>
  );
}
