"use client";

import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { UploadDropzone } from "@/components/engine/UploadDropzone";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IconCheck, IconComment, IconLayers, IconPlus, IconSparkles, IconTrash, IconUndo } from "@/components/ui/icons";
import {
  addHookVariantAction,
  deleteCutAction,
  postVariantsToDriveAction,
  revertToVersionAction,
  updateCutAction,
} from "@/app/engine-actions";
import { timecode } from "@/lib/format";
import type { CutComment, CutWithVersions, Video } from "@/lib/types";

/**
 * The cut's version stack (upload, history, revert) plus its hook variants —
 * each one a full cut with its own upload, versions and comments.
 *
 * Pulled out of `FilesTab` so the same "deliver the cut" controls are exactly
 * one component whether they're reached from the client-facing workspace or
 * an editor's own working view — not a rebuild that quietly drifts from it.
 */
export function CutManager({
  video,
  videoId,
  cuts,
  comments,
  activeCutId,
  onCutChange,
  streamConfigured,
  canEdit,
}: {
  video: Pick<Video, "script_hooks">;
  videoId: string;
  cuts: CutWithVersions[];
  comments: CutComment[];
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
  const [posting, setPosting] = useState<"idle" | "sending" | "done">("idle");

  const activeCut = cuts.find((c) => c.id === activeCutId) ?? cuts[0];
  const hooks = cuts.filter((c) => c.kind === "hook");
  const scriptHooks = video.script_hooks ?? [];
  // One variant per scripted hook beyond the first is the working assumption.
  const expected = Math.max(0, scriptHooks.length);
  const openFor = (cutId: string) =>
    comments.filter((c) => c.cut_id === cutId && !c.resolved && !c.parent_comment_id).length;

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
        <div className="mb-1 flex items-center gap-2">
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
        <p className="mb-2 text-[11px] text-ink-3">
          {expected > 1
            ? `Script has ${expected} hooks · ${hooks.length} variant${hooks.length === 1 ? "" : "s"} uploaded`
            : "Single hook in the script — no variants expected"}
        </p>

        <div className="space-y-1.5">
          {hooks.map((h) => {
            const top = h.versions[0];
            const open = openFor(h.id);
            return (
              <div
                key={h.id}
                className={`rounded-lg border p-2 ${
                  h.id === activeCutId ? "border-accent bg-accent-ghost" : "border-line bg-card"
                }`}
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onCutChange(h.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span className="relative shrink-0 overflow-hidden rounded-md bg-app">
                      {top?.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={top.thumbnail_url} alt="" className="h-10 w-16 object-cover" />
                      ) : (
                        <span className="flex h-10 w-16 items-center justify-center text-ink-3">
                          <IconLayers size={14} />
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">{h.label}</span>
                        {open ? (
                          <span className="flex shrink-0 items-center gap-0.5 rounded bg-accent px-1.5 text-[10px] font-semibold text-white">
                            <IconComment size={9} />
                            {open}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-[10px] text-ink-3">
                        {h.versions.length} ver.{top?.duration_seconds ? ` · ${timecode(top.duration_seconds)}` : ""}
                      </span>
                    </span>
                  </button>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => setConfirmCut(h)}
                      aria-label={`Delete ${h.label}`}
                      className="shrink-0 rounded p-1 text-ink-3 hover:bg-hover hover:text-danger"
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
            );
          })}
          {!hooks.length ? (
            <p className="text-xs text-ink-3">
              No hook variations yet. Each one is a full cut — its own upload, versions and
              comments.
            </p>
          ) : null}
          {expected > 1 && hooks.length < expected - 1 ? (
            <p className="rounded-lg border border-dashed border-line-strong px-3 py-2.5 text-center text-[11px] leading-snug text-ink-3">
              The script has {expected} hooks. Once the main cut is approved this video goes to
              Awaiting Variants until the rest are uploaded.
            </p>
          ) : null}
        </div>

        {canEdit && hooks.length > 0 ? (
          <button
            type="button"
            disabled={posting === "sending"}
            onClick={() => {
              setPosting("sending");
              startTransition(async () => {
                const res = await postVariantsToDriveAction(videoId);
                if (res?.ok) {
                  setPosting("done");
                  toast.success(
                    `Sent ${res.uploaded}/${res.total} variant${res.total === 1 ? "" : "s"} to Drive.` +
                      (res.failed.length ? ` (${res.failed.join(", ")} skipped.)` : "")
                  );
                  setTimeout(() => setPosting("idle"), 2200);
                } else {
                  setPosting("idle");
                  toast.error(res?.error ?? "Couldn't send the variants.");
                }
              });
            }}
            className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-medium transition ${
              posting === "done" ? "bg-ok/15 text-ok" : "bg-accent-ghost text-accent-hi hover:bg-accent/25"
            } disabled:opacity-70`}
          >
            {posting === "sending" ? (
              <>
                <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-accent-hi border-t-transparent" />
                Sending to Drive…
              </>
            ) : posting === "done" ? (
              <>
                <IconCheck size={12} />
                Sent to Drive
              </>
            ) : (
              <>
                <IconSparkles size={12} />
                Post variants to Drive
              </>
            )}
          </button>
        ) : null}

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
            {/* Offer the scripted hooks as one-tap labels — they're already written. */}
            {scriptHooks.length > 1 ? (
              <div className="flex flex-wrap gap-1">
                {scriptHooks.map((h, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setHookLabel(`Hook ${String.fromCharCode(65 + i)}`);
                      setHookNotes(h);
                    }}
                    title={h}
                    className="max-w-full truncate rounded-md border border-line px-2 py-1 text-[10px] text-ink-3 hover:border-accent hover:text-ink"
                  >
                    Hook {String.fromCharCode(65 + i)}
                  </button>
                ))}
              </div>
            ) : null}
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
