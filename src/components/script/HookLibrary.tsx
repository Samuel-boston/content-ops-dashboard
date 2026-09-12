"use client";

import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { IconPlus, IconTrash } from "@/components/ui/icons";
import {
  deleteHookSnippetAction,
  saveHookSnippetAction,
  markHookSnippetUsedAction,
} from "@/app/script-actions";
import type { HookSnippet } from "@/lib/types";

/**
 * Openings that worked, kept to write the next one from. This is where
 * analytics feeds back into writing: save the hook off a video that performed,
 * and it's there the next time you're staring at a blank script.
 */
export function HookLibrary({
  snippets,
  currentHooks,
  videoId,
  onInsert,
}: {
  snippets: HookSnippet[];
  currentHooks: string[];
  videoId: string;
  onInsert: (text: string) => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [, startTransition] = useTrackedTransition();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-sm font-semibold">Hook library</h2>
        <span className="text-xs text-ink-3">{snippets.length}</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto rounded-md px-2 py-1 text-[11px] text-ink-3 hover:bg-hover hover:text-ink"
        >
          {open ? "Done" : "Save one"}
        </button>
      </div>
      <p className="mb-3 text-[11px] leading-snug text-ink-3">
        Patterns worth reusing. Tap one to drop it into this script.
      </p>

      {open ? (
        <div className="mb-3 space-y-1.5">
          <textarea
            value={draft}
            rows={2}
            placeholder="A hook worth keeping…"
            onChange={(e) => setDraft(e.target.value)}
            className="w-full resize-none rounded-lg bg-panel px-2.5 py-2 text-xs placeholder:text-ink-3 focus:outline-none"
          />
          {currentHooks.length ? (
            <div className="flex flex-wrap gap-1">
              {currentHooks.map((h, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setDraft(h)}
                  title={h}
                  className="max-w-full truncate rounded-md border border-line px-2 py-1 text-[10px] text-ink-3 hover:border-accent hover:text-ink"
                >
                  Use hook {i + 1}
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            disabled={!draft.trim()}
            onClick={() =>
              startTransition(async () => {
                const res = await saveHookSnippetAction({ text: draft, sourceVideoId: videoId });
                if (res?.error) toast.error(res.error);
                else {
                  setDraft("");
                  setOpen(false);
                  toast.success("Saved to the library.");
                  router.refresh();
                }
              })
            }
            className="w-full rounded-md bg-accent py-1.5 text-[11px] font-medium text-white hover:bg-accent-hi disabled:opacity-40"
          >
            Save to library
          </button>
        </div>
      ) : null}

      {snippets.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-[11px] text-ink-3">
          Nothing saved yet.
        </p>
      ) : (
        <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
          {snippets.map((s) => (
            <div
              key={s.id}
              className="group flex items-start gap-1.5 rounded-lg bg-panel px-2.5 py-2"
            >
              <button
                type="button"
                onClick={() => {
                  onInsert(s.text);
                  startTransition(async () => {
                    await markHookSnippetUsedAction(s.id);
                  });
                }}
                title="Add to this script"
                className="min-w-0 flex-1 text-left text-[11px] leading-snug text-ink-2 hover:text-ink"
              >
                {s.text}
                {s.times_used > 0 ? (
                  <span className="mt-0.5 block text-[10px] text-ink-3">
                    used {s.times_used}×
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => {
                  onInsert(s.text);
                  startTransition(async () => {
                    await markHookSnippetUsedAction(s.id);
                  });
                }}
                aria-label="Add to script"
                className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
              >
                <IconPlus size={12} />
              </button>
              <button
                type="button"
                onClick={() =>
                  startTransition(async () => {
                    const res = await deleteHookSnippetAction(s.id);
                    if (res?.error) toast.error(res.error);
                    else router.refresh();
                  })
                }
                aria-label="Remove from library"
                className="rounded p-1 text-ink-3 opacity-0 transition group-hover:opacity-100 hover:text-danger"
              >
                <IconTrash size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
