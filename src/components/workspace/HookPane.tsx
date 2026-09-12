"use client";

import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { IconCheck, IconComment, IconLayers, IconPlus, IconSparkles, IconX } from "@/components/ui/icons";
import { addHookVariantAction, postVariantsToDriveAction } from "@/app/engine-actions";
import { timecode } from "@/lib/format";
import type { CutComment, CutWithVersions, Video } from "@/lib/types";

/**
 * The right-hand rail inside a video. Shows this video's cuts — the main one
 * and every hook variant — rather than the pipeline board, which belongs on
 * the board.
 *
 * The count of hooks here is what decides whether the video routes through
 * Awaiting Variants after approval, so the expectation is stated plainly.
 */
export function HookPane({
  video,
  cuts,
  comments,
  activeCutId,
  onCutChange,
  canEdit,
}: {
  video: Video;
  cuts: CutWithVersions[];
  comments: CutComment[];
  activeCutId: string;
  onCutChange: (id: string) => void;
  canEdit: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [, startTransition] = useTrackedTransition();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [posting, setPosting] = useState<"idle" | "sending" | "done">("idle");

  const hooks = cuts.filter((c) => c.kind === "hook");
  const scriptHooks = video.script_hooks ?? [];
  // One variant per scripted hook beyond the first is the working assumption.
  const expected = Math.max(0, scriptHooks.length);
  const delivered = hooks.length;

  const openFor = (cutId: string) =>
    comments.filter((c) => c.cut_id === cutId && !c.resolved && !c.parent_comment_id).length;

  function add() {
    startTransition(async () => {
      const res = await addHookVariantAction(video.id, label, notes);
      if (res?.error) toast.error(res.error);
      else {
        setLabel("");
        setNotes("");
        setAdding(false);
        toast.success("Hook variant added.");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-app">
      <div className="shrink-0 border-b border-line px-3 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Cuts &amp; hooks</h2>
          <span className="text-xs text-ink-3">{cuts.length}</span>
          {canEdit ? (
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              aria-label="Add hook variant"
              className="ml-auto rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-ink"
            >
              {adding ? <IconX size={14} /> : <IconPlus size={14} />}
            </button>
          ) : null}
        </div>
        <p className="mt-0.5 text-[11px] text-ink-3">
          {expected > 1
            ? `Script has ${expected} hooks · ${delivered} variant${delivered === 1 ? "" : "s"} uploaded`
            : "Single hook in the script — no variants expected"}
        </p>

        {canEdit && hooks.length > 0 ? (
          <button
            type="button"
            disabled={posting === "sending"}
            onClick={() => {
              setPosting("sending");
              startTransition(async () => {
                const res = await postVariantsToDriveAction(video.id);
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
            className={`mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-medium transition ${
              posting === "done"
                ? "bg-ok/15 text-ok"
                : "bg-accent-ghost text-accent-hi hover:bg-accent/25"
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
      </div>

      {adding ? (
        <div className="shrink-0 space-y-1.5 border-b border-line p-3">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label — e.g. Hook B"
            className="w-full rounded-md bg-raised px-2 py-1.5 text-xs placeholder:text-ink-3 focus:outline-none"
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
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
                    setLabel(`Hook ${String.fromCharCode(65 + i)}`);
                    setNotes(h);
                  }}
                  title={h}
                  className="max-w-full truncate rounded-md border border-line px-2 py-1 text-[10px] text-ink-3 hover:border-accent hover:text-ink"
                >
                  Hook {String.fromCharCode(65 + i)}
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            onClick={add}
            className="w-full rounded-md bg-accent py-1.5 text-[11px] font-medium text-white hover:bg-accent-hi"
          >
            Add variant
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {cuts.map((c) => {
          const top = c.versions[0];
          const open = openFor(c.id);
          const active = c.id === activeCutId;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onCutChange(c.id)}
              className={`flex w-full gap-2.5 rounded-xl border p-2 text-left transition ${
                active
                  ? "border-accent bg-accent-ghost"
                  : "border-line bg-card hover:border-line-strong hover:bg-raised"
              }`}
            >
              <span className="relative shrink-0 overflow-hidden rounded-lg bg-app">
                {top?.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={top.thumbnail_url} alt="" className="h-14 w-20 object-cover" />
                ) : (
                  <span className="flex h-14 w-20 items-center justify-center text-ink-3">
                    <IconLayers size={16} />
                  </span>
                )}
                {top?.duration_seconds ? (
                  <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 font-mono text-[9px] text-white">
                    {timecode(top.duration_seconds)}
                  </span>
                ) : null}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{c.label}</span>
                  {open ? (
                    <span className="flex shrink-0 items-center gap-0.5 rounded bg-accent px-1.5 text-[10px] font-semibold text-white">
                      <IconComment size={9} />
                      {open}
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[10px] text-ink-3">
                  {c.kind === "main" ? "Main cut" : "Hook variant"}
                  {top ? ` · v${top.version}` : " · nothing uploaded"}
                </span>
                {c.notes ? (
                  <span className="mt-1 block line-clamp-2 text-[10px] leading-snug text-ink-2">
                    {c.notes}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}

        {expected > 1 && delivered < expected - 1 ? (
          <p className="rounded-lg border border-dashed border-line-strong px-3 py-3 text-center text-[11px] leading-snug text-ink-3">
            The script has {expected} hooks. Once the main cut is approved this video goes to
            Awaiting Variants until the rest are uploaded.
          </p>
        ) : null}
      </div>
    </div>
  );
}
