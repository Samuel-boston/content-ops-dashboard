"use client";

import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { TaxonomyMultiSelect } from "@/components/TaxonomyMultiSelect";
import { IconPlus, IconX } from "@/components/ui/icons";
import { updateVideoAction } from "@/app/actions";
import { SeriesPicker } from "@/components/workspace/SeriesPicker";
import type { Series, Video } from "@/lib/types";

/** A field that saves on blur, so nothing needs an explicit Save button. */
function AutoField({
  label,
  value,
  rows = 3,
  placeholder,
  readOnly,
  onCommit,
}: {
  label: string;
  value: string;
  rows?: number;
  placeholder?: string;
  readOnly?: boolean;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // Re-sync when the row changes underneath us (e.g. after a revalidate).
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }

  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
        {label}
      </span>
      <textarea
        value={draft}
        rows={rows}
        readOnly={readOnly}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onCommit(draft);
        }}
        className="w-full resize-y rounded-lg border border-line bg-card px-2.5 py-2 text-sm leading-relaxed text-ink placeholder:text-ink-3 read-only:opacity-70 focus:border-line-strong focus:outline-none"
      />
    </label>
  );
}

/**
 * The editorial brief and script. The script is deliberately three separate
 * fields — hooks, body, CTA — rather than one blob, so an editor can read the
 * hook variations without scrolling past the whole script.
 */
export function BriefTab({
  video,
  customs,
  canEdit,
  seriesOptions = [],
}: {
  video: Video;
  customs: { content_pillar: string[]; format: string[]; platform: string[] };
  canEdit: boolean;
  seriesOptions?: Series[];
}) {
  const toast = useToast();
  const [, startTransition] = useTrackedTransition();
  const [hookDraft, setHookDraft] = useState("");

  const save = (patch: Parameters<typeof updateVideoAction>[1]) =>
    startTransition(async () => {
      const res = await updateVideoAction(video.id, patch);
      if (res?.error) toast.error(res.error);
    });

  const hooks = video.script_hooks ?? [];

  return (
    <div className="h-full space-y-4 overflow-y-auto px-3 py-3">
      <AutoField
        label="Brief"
        value={video.brief ?? ""}
        rows={4}
        readOnly={!canEdit}
        placeholder="What is this video, and what does it need to do?"
        onCommit={(brief) => save({ brief: brief.trim() || null })}
      />

      {/* Script — three separate blocks */}
      <section className="space-y-3 rounded-xl border border-line bg-panel p-3">
        <h3 className="text-xs font-semibold text-ink-2">Script</h3>

        <div>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Hook variations
          </span>
          <div className="space-y-1.5">
            {hooks.map((h, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="mt-2 w-4 shrink-0 text-right font-mono text-[11px] text-ink-3">
                  {i + 1}
                </span>
                <p className="flex-1 rounded-lg border border-line bg-card px-2.5 py-2 text-sm">
                  {h}
                </p>
                {canEdit ? (
                  <button
                    type="button"
                    aria-label={`Remove hook ${i + 1}`}
                    onClick={() => save({ script_hooks: hooks.filter((_, j) => j !== i) })}
                    className="mt-1.5 rounded p-1 text-ink-3 hover:bg-hover hover:text-danger"
                  >
                    <IconX size={13} />
                  </button>
                ) : null}
              </div>
            ))}
            {canEdit ? (
              <div className="flex items-start gap-1.5">
                <span className="w-4 shrink-0" />
                <textarea
                  value={hookDraft}
                  rows={2}
                  placeholder="Add a hook variation…"
                  onChange={(e) => setHookDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      const v = hookDraft.trim();
                      if (!v) return;
                      setHookDraft("");
                      save({ script_hooks: [...hooks, v] });
                    }
                  }}
                  className="flex-1 resize-none rounded-lg border border-dashed border-line-strong bg-transparent px-2.5 py-2 text-sm placeholder:text-ink-3 focus:outline-none"
                />
                <button
                  type="button"
                  aria-label="Add hook"
                  onClick={() => {
                    const v = hookDraft.trim();
                    if (!v) return;
                    setHookDraft("");
                    save({ script_hooks: [...hooks, v] });
                  }}
                  className="mt-1.5 rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
                >
                  <IconPlus size={13} />
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <AutoField
          label="Body"
          value={video.script_body ?? ""}
          rows={5}
          readOnly={!canEdit}
          onCommit={(v) => save({ script_body: v.trim() || null })}
        />
        <AutoField
          label="CTA"
          value={video.script_cta ?? ""}
          rows={2}
          readOnly={!canEdit}
          onCommit={(v) => save({ script_cta: v.trim() || null })}
        />
      </section>

      {canEdit ? (
        <section className="space-y-3">
          <TaxonomyMultiSelect
            kind="content_pillar"
            selected={video.content_pillars}
            customs={customs.content_pillar}
            onChange={(content_pillars) => save({ content_pillars })}
          />
          <TaxonomyMultiSelect
            kind="format"
            selected={video.formats}
            customs={customs.format}
            onChange={(formats) => save({ formats })}
          />
          <TaxonomyMultiSelect
            kind="platform"
            selected={video.platforms}
            customs={customs.platform}
            onChange={(platforms) => save({ platforms })}
          />
        </section>
      ) : (
        <section className="space-y-2">
          {(
            [
              ["Content pillar", video.content_pillars],
              ["Format", video.formats],
              ["Platform", video.platforms],
            ] as const
          ).map(([label, values]) => (
            <div key={label}>
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                {label}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {values.length ? (
                  values.map((v) => (
                    <span key={v} className="rounded-md bg-card px-2 py-1 text-xs text-ink-2">
                      {v}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-ink-3">—</span>
                )}
              </div>
            </div>
          ))}
        </section>
      )}
      <SeriesPicker
        videoId={video.id}
        seriesId={video.series_id}
        position={video.series_position}
        options={seriesOptions}
        canEdit={canEdit}
      />
    </div>
  );
}
