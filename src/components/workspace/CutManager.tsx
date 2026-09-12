"use client";

import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { UploadDropzone } from "@/components/engine/UploadDropzone";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconLayers, IconPlus, IconTrash, IconUndo } from "@/components/ui/icons";
import {
  addHookVariantAction,
  deleteCutAction,
  revertToVersionAction,
  updateCutAction,
} from "@/app/engine-actions";
import { timecode } from "@/lib/format";
import type { CutWithVersions } from "@/lib/types";

/**
 * The cut's version stack (upload, history, revert) plus its hook variants —
 * each one a full cut with its own upload, versions and comments.
 *
 * Pulled out of `FilesTab` so the same "deliver the cut" controls are exactly
 * one component whether they're reached from the client-facing workspace or
 * an editor's own working view — not a rebuild that quietly drifts from it.
 */
export function CutManager({
  videoId,
  cuts,
  activeCutId,
  onCutChange,
  streamConfigured,
  canEdit,
}: {
  videoId: string;
  cuts: CutWithVersions[];
  activeCutId: string;
  onCutChange: (id: string) => void;
  streamConfigured: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTrackedTransition();
  const [addingHook, setAddingHook] = useState(false);
  const [hookLabel, setHookLabel] = useState("");
  const [hookNotes, setHookNotes] = useState("");
  const [confirmCut, setConfirmCut] = useState<CutWithVersions | null>(null);

  const activeCut = cuts.find((c) => c.id === activeCutId) ?? cuts[0];
  const hooks = cuts.filter((c) => c.kind === "hook");

  return (
    <>
      {/* Version stack for the selected cut */}
      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          {activeCut?.label ?? "Cut"} — versions
        </h3>
        <div className="space-y-1.5">
          {activeCut?.versions.map((v) => (
            <div
              key={v.id}
              className="flex items-center gap-2 rounded-lg border border-line bg-card px-2.5 py-2"
            >
              <IconLayers size={13} className="text-ink-3" />
              <span className="text-xs font-medium">v{v.version}</span>
              <span className="text-[11px] text-ink-3">
                {v.duration_seconds ? timecode(v.duration_seconds) : v.status}
              </span>
              {v.drive_file_url ? (
                <a
                  href={v.drive_file_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-[11px] text-accent-hi hover:underline"
                >
                  Drive
                </a>
              ) : null}
              {canEdit && v.version !== activeCut.versions[0]?.version ? (
                <button
                  type="button"
                  title="Restore this cut as a new version"
                  onClick={() =>
                    startTransition(async () => {
                      const res = await revertToVersionAction(activeCut.id, v.version);
                      if (res?.error) toast.error(res.error);
                      else {
                        toast.success(`v${v.version} restored as the latest version.`);
                        router.refresh();
                      }
                    })
                  }
                  className="ml-auto rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
                >
                  <IconUndo size={13} />
                </button>
              ) : null}
            </div>
          ))}
          {!activeCut?.versions.length ? (
            <p className="text-xs text-ink-3">No versions uploaded yet.</p>
          ) : null}
        </div>

        {canEdit && activeCut ? (
          <div className="mt-2">
            {streamConfigured ? (
              <UploadDropzone cutId={activeCut.id} compact />
            ) : (
              <p className="rounded-lg border border-dashed border-line-strong px-3 py-3 text-center text-[11px] text-ink-3">
                Connect Cloudflare Stream in Settings → Integrations to upload cuts.
              </p>
            )}
          </div>
        ) : null}
      </section>

      {/* Hook variants */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Hook variations
          </h3>
          {canEdit ? (
            <button
              type="button"
              onClick={() => setAddingHook((v) => !v)}
              aria-label="Add hook variation"
              className="ml-auto rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
            >
              <IconPlus size={13} />
            </button>
          ) : null}
        </div>

        <div className="space-y-1.5">
          {hooks.map((h) => (
            <div
              key={h.id}
              className={`rounded-lg border px-2.5 py-2 ${
                h.id === activeCutId ? "border-accent bg-accent-ghost" : "border-line bg-card"
              }`}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onCutChange(h.id)}
                  className="min-w-0 flex-1 truncate text-left text-xs font-medium hover:text-accent-hi"
                >
                  {h.label}
                </button>
                <span className="text-[10px] text-ink-3">{h.versions.length} ver.</span>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => setConfirmCut(h)}
                    aria-label={`Delete ${h.label}`}
                    className="rounded p-1 text-ink-3 hover:bg-hover hover:text-danger"
                  >
                    <IconTrash size={12} />
                  </button>
                ) : null}
              </div>
              <textarea
                defaultValue={h.notes ?? ""}
                readOnly={!canEdit}
                rows={2}
                placeholder="Notes on this hook…"
                onBlur={(e) => {
                  if (!canEdit || e.target.value === (h.notes ?? "")) return;
                  startTransition(async () => {
                    const res = await updateCutAction(h.id, {
                      notes: e.target.value.trim() || null,
                    });
                    if (res?.error) toast.error(res.error);
                  });
                }}
                className="mt-1.5 w-full resize-none rounded-md bg-raised px-2 py-1.5 text-[11px] placeholder:text-ink-3 focus:outline-none"
              />
            </div>
          ))}
          {!hooks.length ? (
            <p className="text-xs text-ink-3">
              No hook variations yet. Each one is a full cut — its own upload, versions and
              comments.
            </p>
          ) : null}
        </div>

        {addingHook ? (
          <div className="mt-2 space-y-1.5 rounded-lg border border-line bg-card p-2.5">
            <input
              value={hookLabel}
              onChange={(e) => setHookLabel(e.target.value)}
              placeholder="Label — e.g. Hook B"
              className="w-full rounded-md bg-raised px-2 py-1.5 text-xs placeholder:text-ink-3 focus:outline-none"
            />
            <textarea
              value={hookNotes}
              onChange={(e) => setHookNotes(e.target.value)}
              rows={2}
              placeholder="What's different about this hook?"
              className="w-full resize-none rounded-md bg-raised px-2 py-1.5 text-xs placeholder:text-ink-3 focus:outline-none"
            />
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setAddingHook(false)}
                className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:bg-hover"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  startTransition(async () => {
                    const res = await addHookVariantAction(videoId, hookLabel, hookNotes);
                    if (res?.error) toast.error(res.error);
                    else {
                      setHookLabel("");
                      setHookNotes("");
                      setAddingHook(false);
                      router.refresh();
                    }
                  })
                }
                className="rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-accent-hi"
              >
                Add hook
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <ConfirmDialog
        open={!!confirmCut}
        title={`Delete ${confirmCut?.label ?? "this hook"}?`}
        body="Its versions and comments go with it. This can't be undone."
        confirmLabel="Delete"
        onCancel={() => setConfirmCut(null)}
        onConfirm={() => {
          const cut = confirmCut;
          setConfirmCut(null);
          if (!cut) return;
          startTransition(async () => {
            const res = await deleteCutAction(cut.id);
            if (res?.error) toast.error(res.error);
            else {
              if (activeCutId === cut.id) onCutChange(cuts[0].id);
              router.refresh();
            }
          });
        }}
      />
    </>
  );
}
