"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { IconPlus, IconSparkles, IconX } from "@/components/ui/icons";
import {
  createIdeaFromOptionAction,
  generateIdeaOptionsAction,
  type IdeaOption,
} from "@/app/ai-actions";

type Mode = "performers" | "prompt";

/**
 * Generates a few idea OPTIONS and lets you pick which (if any) are worth
 * keeping — never auto-creates anything. Two ways to ground it, picked
 * before it generates rather than left to guess: real inspiration from what
 * already performed well, or a specific direction you type in. Either way
 * it's seeded from this account's own pillars, recent titles, SOP guide, and
 * a couple of posted scripts.
 */
export function IdeaGeneratorButton() {
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("performers");
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [ideas, setIdeas] = useState<IdeaOption[] | null>(null);
  const [addingIndex, setAddingIndex] = useState<number | null>(null);
  const [added, setAdded] = useState<Set<number>>(new Set());

  function generate() {
    setPending(true);
    setIdeas(null);
    setAdded(new Set());
    generateIdeaOptionsAction({ mode, prompt: mode === "prompt" ? prompt.trim() : undefined }).then(
      (res) => {
        setPending(false);
        if (res?.error) toast.error(res.error);
        else if (res?.ok) setIdeas(res.ideas);
      }
    );
  }

  function addOne(i: number) {
    if (!ideas) return;
    setAddingIndex(i);
    createIdeaFromOptionAction(ideas[i]).then((res) => {
      setAddingIndex(null);
      if (res?.error) toast.error(res.error);
      else if (res?.ok) {
        setAdded((s) => new Set(s).add(i));
        toast.success(`Added "${ideas[i].title}" to Ideation.`);
        router.refresh();
      }
    });
  }

  function close() {
    setOpen(false);
    setIdeas(null);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 transition hover:border-accent hover:text-ink"
      >
        <IconSparkles size={14} />
        Suggest ideas
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div className="absolute left-0 top-full z-50 mt-2 w-[26rem] max-w-[90vw] space-y-3 rounded-xl border border-line bg-card p-3 shadow-2xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-ink-2">Suggest ideas</span>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
              >
                <IconX size={13} />
              </button>
            </div>

            <div className="flex gap-1.5 rounded-lg bg-panel p-1">
              <button
                type="button"
                onClick={() => setMode("performers")}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${
                  mode === "performers" ? "bg-card text-ink shadow-sm" : "text-ink-3 hover:text-ink-2"
                }`}
              >
                From my best performers
              </button>
              <button
                type="button"
                onClick={() => setMode("prompt")}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${
                  mode === "prompt" ? "bg-card text-ink shadow-sm" : "text-ink-3 hover:text-ink-2"
                }`}
              >
                From a prompt
              </button>
            </div>

            {mode === "performers" ? (
              <p className="text-[11px] leading-snug text-ink-3">
                Takes real inspiration from whichever of your posted videos have the most views —
                the angle and pillar that worked, not just the topic.
              </p>
            ) : (
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. “something about pricing objections”, “a series like the career-change one”…"
                rows={2}
                className="w-full resize-none rounded-lg border border-line bg-raised px-2.5 py-2 text-xs placeholder:text-ink-3 focus:border-accent focus:outline-none"
              />
            )}

            <button
              type="button"
              disabled={pending}
              onClick={generate}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition hover:bg-accent-hi disabled:opacity-50"
            >
              <IconSparkles size={13} />
              {pending ? "Thinking…" : ideas ? "Generate more" : "Generate"}
            </button>

            {ideas ? (
              <div className="max-h-96 space-y-2 overflow-y-auto border-t border-line pt-2.5">
                <span className="text-[11px] text-ink-3">
                  {ideas.length} idea{ideas.length === 1 ? "" : "s"} — add the ones worth keeping
                </span>
                {ideas.map((idea, i) => (
                  <div key={i} className="rounded-lg border border-line bg-app p-2.5">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-snug">{idea.title}</p>
                        <p className="mt-0.5 text-xs italic leading-snug text-ink-2">
                          &ldquo;{idea.hook}&rdquo;
                        </p>
                        {idea.why ? (
                          <p className="mt-1 text-[11px] leading-snug text-ink-3">{idea.why}</p>
                        ) : null}
                        <span className="mt-1 inline-block rounded bg-hover px-1.5 py-0.5 text-[10px] text-ink-3">
                          {idea.pillar}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={addingIndex === i || added.has(i)}
                        onClick={() => addOne(i)}
                        className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
                          added.has(i)
                            ? "bg-ok/15 text-ok"
                            : "bg-accent-ghost text-accent-hi hover:bg-accent/25"
                        } disabled:opacity-60`}
                      >
                        {added.has(i) ? (
                          "Added ✓"
                        ) : addingIndex === i ? (
                          "Adding…"
                        ) : (
                          <>
                            <IconPlus size={11} />
                            Add
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
