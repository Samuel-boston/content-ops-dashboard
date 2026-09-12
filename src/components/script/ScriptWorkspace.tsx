"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { TaxonomyMultiSelect } from "@/components/TaxonomyMultiSelect";
import { VoicePlayer, VoiceRecorder, type VoiceCapture } from "@/components/workspace/Voice";
import { StageMove } from "@/components/pipeline/StageMove";
import { StageBack } from "@/components/pipeline/StageBack";
import { PlanningStageBar } from "@/components/pipeline/PlanningStageBar";
import { Teleprompter } from "@/components/script/Teleprompter";
import { HookLibrary } from "@/components/script/HookLibrary";
import {
  IconCheck,
  IconChart,
  IconGrip,
  IconMic,
  IconPlus,
  IconSparkles,
  IconTrash,
  IconX,
} from "@/components/ui/icons";
import { saveBriefVoiceAction, saveScriptAction, transcribeBriefAction } from "@/app/script-actions";
import {
  draftScriptAction,
  finishScriptAction,
  generateCtaAction,
  generateHooksAction,
  rephraseSelectionAction,
  structureBriefAction,
} from "@/app/ai-actions";
import { updateVideoAction } from "@/app/actions";
import { uploadCommentMedia } from "@/lib/upload-client";
import { readTime } from "@/lib/format";
import { type HookSnippet, type Profile, type Video } from "@/lib/types";

/**
 * The client's writing room. Deliberately one job per pane: the script on the
 * left with nothing competing for attention, everything about the video on the
 * right.
 *
 * The hook list is load-bearing beyond the script itself — more than one hook
 * here is what tells the pipeline this video needs hook variants, and routes it
 * through Awaiting Variants after approval.
 */
export function ScriptWorkspace({
  video,
  viewer,
  customs,
  briefVoiceUrl,
  snippets,
}: {
  video: Video;
  viewer: Profile;
  customs: { content_pillar: string[]; format: string[]; platform: string[] };
  briefVoiceUrl: string | null;
  snippets: HookSnippet[];
}) {
  const toast = useToast();
  const router = useRouter();
  const [, startTransition] = useTrackedTransition();

  const [hooks, setHooks] = useState<string[]>(video.script_hooks ?? []);
  const [draftHook, setDraftHook] = useState("");
  const [body, setBody] = useState(video.script_body ?? "");
  const [cta, setCta] = useState(video.script_cta ?? "");
  const [brief, setBrief] = useState(video.brief ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceUrl, setVoiceUrl] = useState(briefVoiceUrl);
  const [voiceMeta, setVoiceMeta] = useState<{ duration: number | null; peaks: number[] | null }>({
    duration: video.brief_voice_duration_seconds,
    peaks: video.brief_voice_peaks,
  });
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [prompting, setPrompting] = useState(false);
  const [generatingHooks, setGeneratingHooks] = useState(false);
  const [hookOptions, setHookOptions] = useState<string[] | null>(null);
  const [addedOptions, setAddedOptions] = useState<Set<number>>(new Set());
  const [refinement, setRefinement] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [structuring, setStructuring] = useState(false);
  const [bodySelection, setBodySelection] = useState<{ start: number; end: number; text: string } | null>(
    null
  );
  const [rephrasing, setRephrasing] = useState(false);
  const [rephraseInstruction, setRephraseInstruction] = useState("");
  const [rephraseSuggestion, setRephraseSuggestion] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [addingCta, setAddingCta] = useState(false);
  const [needsContext, setNeedsContext] = useState(false);
  const [savingContext, setSavingContext] = useState(false);
  const [showDraftPrompt, setShowDraftPrompt] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState("");

  const bodyTime = readTime(body);
  const fullTime = readTime([hooks[0] ?? "", body, cta].filter(Boolean).join(" "));

  const save = useCallback(
    (next?: { hooks?: string[]; body?: string; cta?: string }) => {
      const payload = {
        hooks: next?.hooks ?? hooks,
        body: next?.body ?? body,
        cta: next?.cta ?? cta,
      };
      setSaving(true);
      startTransition(async () => {
        const res = await saveScriptAction(video.id, payload);
        setSaving(false);
        if (res?.error) toast.error(res.error);
        else {
          setDirty(false);
          router.refresh();
        }
      });
    },
    [hooks, body, cta, video.id, toast, router, startTransition]
  );

  function runDraft() {
    setDrafting(true);
    startTransition(async () => {
      const res = await draftScriptAction(video.id, hooks[0], draftPrompt.trim() || undefined);
      setDrafting(false);
      if (res?.error) {
        // A specific, recoverable failure — no brief/idea notes to draft
        // from yet — gets its own prompt instead of a dead-end toast, since
        // the fix is one text box away.
        if (res.error.includes("Add a brief or idea notes")) {
          setShowDraftPrompt(false);
          setNeedsContext(true);
        } else {
          toast.error(res.error);
        }
      } else if (res?.ok) {
        setBody(res.body);
        setCta(res.cta);
        save({ body: res.body, cta: res.cta });
        setShowDraftPrompt(false);
        setDraftPrompt("");
        toast.success("Draft added — read it over before it goes anywhere.");
      }
    });
  }

  function addHook(value: string) {
    const v = value.trim();
    if (!v) return;
    const next = [...hooks, v];
    setHooks(next);
    setDraftHook("");
    save({ hooks: next });
  }

  function removeHook(i: number) {
    const next = hooks.filter((_, j) => j !== i);
    setHooks(next);
    save({ hooks: next });
  }

  function reorder(from: number, to: number) {
    if (from === to) return;
    const next = [...hooks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setHooks(next);
    save({ hooks: next });
  }

  const onVoiceDone = useCallback(
    async (capture: VoiceCapture) => {
      setRecording(false);
      try {
        const up = await uploadCommentMedia(capture.blob, "brief.webm", viewer.id);
        const res = await saveBriefVoiceAction(video.id, {
          path: up.path,
          duration: capture.duration,
          peaks: capture.peaks,
        });
        if (res?.error) {
          toast.error(res.error);
          return;
        }
        setVoiceUrl(URL.createObjectURL(capture.blob));
        setVoiceMeta({ duration: capture.duration, peaks: capture.peaks });
        toast.success("Brief recorded.");
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [video.id, viewer.id, toast, router]
  );

  const variantsExpected = hooks.length > 1;
  const canEditStage = viewer.role === "owner" || viewer.role === "admin";
  // Come back to the list you most likely arrived from.
  const [backHref, backLabel] =
    video.status === "ready_to_film"
      ? (["/filming", "Filming"] as const)
      : video.status === "ideation"
        ? (["/ideation", "Ideation"] as const)
        : (["/scripting", "Scripting"] as const);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      {/* ---- The script ---- */}
      {/* min-w-0: a grid item defaults to min-width:auto, so a child that
          won't shrink (the status dropdown, sized to its longest option)
          pushes the whole column past a phone's width. */}
      <div className="min-w-0 space-y-5">
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={backHref} className="text-sm text-ink-3 hover:text-ink">
              {backLabel}
            </Link>
            <span className="text-ink-3">/</span>
            <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{video.title}</h1>
            <Link
              href={`/videos/${video.id}`}
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 hover:bg-hover hover:text-ink"
            >
              Video review →
            </Link>
          </div>
          <PlanningStageBar videoId={video.id} current={video.status} canEdit={canEditStage} />
        </div>

        {/* Hooks */}
        <section className="rounded-2xl border border-line bg-card p-4">
          <div className="mb-1 flex items-center gap-2">
            <h2 className="text-sm font-semibold">Hooks</h2>
            <span className="text-xs text-ink-3">{hooks.length}</span>
            <span
              className={`ml-auto rounded-md px-2 py-0.5 text-[10px] ${
                variantsExpected
                  ? "bg-stage-variants/15 text-stage-variants"
                  : "bg-panel text-ink-3"
              }`}
            >
              {variantsExpected ? "Hook variants expected" : "Single hook — no variants"}
            </span>
          </div>
          <p className="mb-1 text-xs leading-relaxed text-ink-3">
            The first hook is the one the main cut opens on. Add more and the editor will be asked
            for a variant of each after you approve the cut.
          </p>
          <div className="mb-2 flex items-center gap-1.5">
            <input
              value={refinement}
              onChange={(e) => setRefinement(e.target.value)}
              placeholder="Optional direction — e.g. &ldquo;about pricing objections&rdquo;, &ldquo;punchier&rdquo;…"
              className="min-w-0 flex-1 rounded-md border border-line bg-raised px-2.5 py-1.5 text-[11px] placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
          </div>
          <button
            type="button"
            disabled={generatingHooks}
            onClick={() => {
              setGeneratingHooks(true);
              startTransition(async () => {
                const res = await generateHooksAction(video.id, refinement.trim() || undefined);
                setGeneratingHooks(false);
                if (res?.error) toast.error(res.error);
                else if (res?.hooks?.length) {
                  setHookOptions(res.hooks);
                  setAddedOptions(new Set());
                }
              });
            }}
            className="mb-1 flex items-center gap-1.5 rounded-lg bg-accent-ghost px-2.5 py-1.5 text-[11px] font-medium text-accent-hi hover:bg-accent/25 disabled:opacity-50"
          >
            <IconSparkles size={12} />
            {generatingHooks ? "Writing 10 hooks…" : hookOptions ? "Generate 10 more" : "Suggest 10 hooks"}
          </button>
          <p className="mb-3 text-[10px] leading-snug text-ink-3">
            Reads this video&rsquo;s title/brief/idea notes/pillar automatically — no separate setup —
            plus your SOP guide and a few of your own posted scripts, so it sounds like you rather
            than generic AI. Nothing here is a permanent &ldquo;training&rdquo; step; it re-reads fresh every time.
            These are options — nothing&rsquo;s added until you pick one.
          </p>

          {hookOptions ? (
            <div className="mb-3 space-y-2 rounded-xl border border-line bg-app p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-ink-2">
                  {hookOptions.length} option{hookOptions.length === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  onClick={() => setHookOptions(null)}
                  className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
                  aria-label="Dismiss options"
                >
                  <IconX size={12} />
                </button>
              </div>
              <div className="max-h-64 space-y-1.5 overflow-y-auto">
                {hookOptions.map((h, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-lg bg-panel px-2.5 py-2 text-xs leading-snug"
                  >
                    <span className="min-w-0 flex-1">{h}</span>
                    <button
                      type="button"
                      disabled={addedOptions.has(i)}
                      onClick={() => {
                        const next = [...hooks, h];
                        setHooks(next);
                        save({ hooks: next });
                        setAddedOptions((s) => new Set(s).add(i));
                      }}
                      className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-medium transition ${
                        addedOptions.has(i)
                          ? "bg-ok/15 text-ok"
                          : "bg-accent-ghost text-accent-hi hover:bg-accent/25"
                      } disabled:opacity-70`}
                    >
                      {addedOptions.has(i) ? "Added ✓" : "Add as variant"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="space-y-1.5">
            {hooks.map((h, i) => (
              <div
                key={`${i}-${h.slice(0, 12)}`}
                draggable
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndex !== null) reorder(dragIndex, i);
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragIndex(null)}
                className={`flex items-start gap-2 rounded-xl border bg-panel px-2.5 py-2 transition ${
                  dragIndex === i ? "border-accent opacity-50" : "border-line"
                }`}
              >
                <span className="mt-1 cursor-grab text-ink-3" title="Drag to reorder">
                  <IconGrip size={13} />
                </span>
                <span className="mt-0.5 w-4 shrink-0 text-right font-mono text-[11px] text-ink-3">
                  {i + 1}
                </span>
                <textarea
                  value={h}
                  rows={2}
                  onChange={(e) => {
                    const next = [...hooks];
                    next[i] = e.target.value;
                    setHooks(next);
                    setDirty(true);
                  }}
                  onBlur={() => dirty && save()}
                  className="min-w-0 flex-1 resize-none bg-transparent text-sm leading-snug focus:outline-none"
                />
                <span className="mt-1.5 w-8 shrink-0 text-right text-[10px] tabular-nums text-ink-3">
                  {readTime(h).label}
                </span>
                <button
                  type="button"
                  aria-label={`Remove hook ${i + 1}`}
                  onClick={() => removeHook(i)}
                  className="mt-0.5 rounded p-1 text-ink-3 hover:bg-hover hover:text-danger"
                >
                  <IconX size={13} />
                </button>
              </div>
            ))}

            <div className="flex items-start gap-2 rounded-xl border border-dashed border-line-strong px-2.5 py-2">
              <span className="mt-1 w-4 shrink-0 text-right font-mono text-[11px] text-ink-3">
                {hooks.length + 1}
              </span>
              <textarea
                value={draftHook}
                rows={2}
                placeholder="Write another hook…"
                onChange={(e) => setDraftHook(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    addHook(draftHook);
                  }
                }}
                className="min-w-0 flex-1 resize-none bg-transparent text-sm leading-snug placeholder:text-ink-3 focus:outline-none"
              />
              <button
                type="button"
                aria-label="Add hook"
                onClick={() => addHook(draftHook)}
                className="mt-0.5 rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
              >
                <IconPlus size={13} />
              </button>
            </div>
          </div>
        </section>

        {/* Body */}
        <section className="rounded-2xl border border-line bg-card p-4">
          <div className="mb-2 flex items-baseline gap-2">
            <h2 className="text-sm font-semibold">Body</h2>
            <span className="text-[11px] tabular-nums text-ink-3">
              {bodyTime.words} words · {bodyTime.label} spoken
            </span>
            <button
              type="button"
              disabled={finishing || !body.trim()}
              title="Continue the body to a natural finish, from what's already written"
              onClick={() => {
                setFinishing(true);
                startTransition(async () => {
                  const res = await finishScriptAction(video.id, body);
                  setFinishing(false);
                  if (res?.error) {
                    toast.error(res.error);
                  } else if (res?.ok) {
                    const next = `${body.trimEnd()}\n\n${res.rest}`;
                    setBody(next);
                    save({ body: next });
                    toast.success("Finished the body below.");
                  }
                });
              }}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-accent hover:text-ink disabled:opacity-40"
            >
              <IconSparkles size={11} />
              {finishing ? "Finishing…" : "Finish script"}
            </button>
          </div>

          {bodySelection && !rephraseSuggestion ? (
            <div className="mb-2 space-y-1.5 rounded-lg border border-dashed border-line-strong bg-app px-2.5 py-2">
              <p className="truncate text-[11px] text-ink-3">
                Selected: &ldquo;{bodySelection.text}&rdquo;
              </p>
              <div className="flex items-center gap-2">
                <input
                  value={rephraseInstruction}
                  onChange={(e) => setRephraseInstruction(e.target.value)}
                  placeholder="Optional instruction — e.g. &ldquo;more casual&rdquo;, &ldquo;punchier&rdquo;…"
                  className="min-w-0 flex-1 rounded-md border border-line bg-raised px-2 py-1.5 text-[11px] placeholder:text-ink-3 focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  disabled={rephrasing}
                  onClick={() => {
                    setRephrasing(true);
                    startTransition(async () => {
                      const res = await rephraseSelectionAction(
                        video.id,
                        bodySelection.text,
                        body.slice(0, bodySelection.start),
                        body.slice(bodySelection.end),
                        rephraseInstruction.trim() || undefined
                      );
                      setRephrasing(false);
                      if (res?.error) toast.error(res.error);
                      else if (res?.ok) setRephraseSuggestion(res.rewrite);
                    });
                  }}
                  className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-accent-hi disabled:opacity-50"
                >
                  <IconSparkles size={10} />
                  {rephrasing ? "Rephrasing…" : "Rephrase"}
                </button>
              </div>
            </div>
          ) : null}

          {bodySelection && rephraseSuggestion ? (
            <div className="mb-2 space-y-1.5 rounded-lg border border-accent/40 bg-accent-ghost px-2.5 py-2">
              <p className="text-[11px] text-ink-2">
                Suggested: &ldquo;{rephraseSuggestion}&rdquo;
              </p>
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setRephraseSuggestion(null);
                    setBodySelection(null);
                    setRephraseInstruction("");
                  }}
                  className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:bg-hover"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next =
                      body.slice(0, bodySelection.start) + rephraseSuggestion + body.slice(bodySelection.end);
                    setBody(next);
                    save({ body: next });
                    setRephraseSuggestion(null);
                    setBodySelection(null);
                    setRephraseInstruction("");
                  }}
                  className="flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-accent-hi"
                >
                  <IconCheck size={10} />
                  Use this
                </button>
              </div>
            </div>
          ) : null}

          <textarea
            value={body}
            rows={14}
            placeholder="The middle of the video — what actually gets said."
            onChange={(e) => {
              setBody(e.target.value);
              setDirty(true);
              setBodySelection(null);
              setRephraseSuggestion(null);
            }}
            onSelect={(e) => {
              const el = e.currentTarget;
              if (el.selectionEnd > el.selectionStart) {
                setBodySelection({
                  start: el.selectionStart,
                  end: el.selectionEnd,
                  text: body.slice(el.selectionStart, el.selectionEnd),
                });
                setRephraseSuggestion(null);
              } else {
                setBodySelection(null);
              }
            }}
            onBlur={() => dirty && save()}
            className="w-full resize-y bg-transparent text-sm leading-relaxed placeholder:text-ink-3 focus:outline-none"
          />
        </section>

        {/* CTA */}
        <section className="rounded-2xl border border-line bg-card p-4">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-sm font-semibold">Call to action</h2>
            <button
              type="button"
              disabled={addingCta || !body.trim()}
              title={body.trim() ? "Suggest a CTA from the finished body" : "Write the body first"}
              onClick={() => {
                setAddingCta(true);
                startTransition(async () => {
                  const res = await generateCtaAction(video.id);
                  setAddingCta(false);
                  if (res?.error) {
                    toast.error(res.error);
                  } else if (res?.ok) {
                    setCta(res.cta);
                    save({ cta: res.cta });
                    toast.success("CTA added.");
                  }
                });
              }}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-accent hover:text-ink disabled:opacity-40"
            >
              <IconSparkles size={11} />
              {addingCta ? "Writing…" : "Add CTA"}
            </button>
          </div>
          <textarea
            value={cta}
            rows={3}
            placeholder="How it closes."
            onChange={(e) => {
              setCta(e.target.value);
              setDirty(true);
            }}
            onBlur={() => dirty && save()}
            className="w-full resize-y bg-transparent text-sm leading-relaxed placeholder:text-ink-3 focus:outline-none"
          />
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-ink-3">
            {saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved"}
          </span>
          <span className="text-xs text-ink-3">
            Full read: <span className="tabular-nums text-ink-2">{fullTime.label}</span>
          </span>
          <button
            type="button"
            onClick={() => setPrompting(true)}
            disabled={!body.trim() && !hooks.some((h) => h.trim()) && !cta.trim()}
            className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 transition hover:border-accent hover:text-ink disabled:opacity-40"
          >
            <IconChart size={13} />
            Teleprompter
          </button>
          <button
            type="button"
            disabled={drafting}
            onClick={() => setShowDraftPrompt((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg bg-accent-ghost px-2.5 py-1.5 text-xs font-medium text-accent-hi transition hover:bg-accent/25 disabled:opacity-50"
          >
            <IconSparkles size={13} />
            {drafting ? "Drafting…" : "Draft with AI"}
          </button>
          <span
            title="Uses this video's brief/idea notes, the chosen hook, your SOP guide, and a few of your own posted scripts as tone examples."
            className="text-[11px] text-ink-3"
          >
            (uses the brief + your house style)
          </span>
          {video.status === "scripting" && canEditStage ? (
            <div className="ml-auto flex items-center gap-1">
              <StageBack videoId={video.id} status={video.status} />
              <StageMove
                videoId={video.id}
                to="ready_to_film"
                label="Script done — ready to film"
                goTo={`/videos/${video.id}/film`}
              />
            </div>
          ) : video.status === "ready_to_film" && canEditStage ? (
            <div className="ml-auto flex items-center gap-1">
              <StageBack videoId={video.id} status={video.status} />
              <StageMove
                videoId={video.id}
                to="editor_brief"
                label="Filmed — build the brief"
                goTo={`/videos/${video.id}/editor-brief`}
              />
            </div>
          ) : video.status === "editor_brief" ? (
            <span className="ml-auto flex items-center gap-1.5 text-xs text-ink-2">
              <IconSparkles size={13} />
              <Link href={`/videos/${video.id}/editor-brief`} className="hover:text-accent-hi">
                Building the editor brief
              </Link>
            </span>
          ) : video.status === "ready_to_edit" ? (
            <span className="ml-auto flex items-center gap-1.5 text-xs text-ok">
              <IconCheck size={13} />
              With the editors
            </span>
          ) : null}
        </div>

        {showDraftPrompt ? (
          <div className="space-y-2 rounded-xl border border-dashed border-line-strong bg-app p-3">
            <p className="flex items-center gap-1.5 text-xs text-ink-2">
              <IconSparkles size={12} />
              Give it direction, or leave it blank and it&rsquo;ll go from the brief alone.
            </p>
            <textarea
              value={draftPrompt}
              rows={2}
              autoFocus
              placeholder="e.g. “lead with the stat, not the story”, “make it punchier”, “keep it under 30 seconds”…"
              onChange={(e) => setDraftPrompt(e.target.value)}
              className="w-full resize-none rounded-lg border border-line bg-raised px-2.5 py-2 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDraftPrompt(false)}
                className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 hover:bg-hover"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={drafting}
                onClick={runDraft}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-white hover:bg-accent-hi disabled:opacity-60"
              >
                <IconSparkles size={12} />
                {drafting ? "Drafting…" : "Generate"}
              </button>
            </div>
          </div>
        ) : null}

        {needsContext ? (
          <div className="space-y-2 rounded-xl border border-dashed border-line-strong bg-app p-3">
            <p className="flex items-center gap-1.5 text-xs text-ink-2">
              <IconSparkles size={12} />
              Nothing to draft from yet — give it something to work with, or record a spoken brief
              above and try again.
            </p>
            <textarea
              value={brief}
              rows={3}
              autoFocus
              placeholder="Angle, key points, anything you already know…"
              onChange={(e) => setBrief(e.target.value)}
              className="w-full resize-none rounded-lg border border-line bg-raised px-2.5 py-2 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNeedsContext(false)}
                className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 hover:bg-hover"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingContext || !brief.trim()}
                onClick={() => {
                  setSavingContext(true);
                  startTransition(async () => {
                    const saveRes = await updateVideoAction(video.id, { brief: brief.trim() });
                    if (saveRes?.error) {
                      setSavingContext(false);
                      toast.error(saveRes.error);
                      return;
                    }
                    setNeedsContext(false);
                    setDrafting(true);
                    const res = await draftScriptAction(video.id, hooks[0], draftPrompt.trim() || undefined);
                    setSavingContext(false);
                    setDrafting(false);
                    if (res?.error) toast.error(res.error);
                    else if (res?.ok) {
                      setBody(res.body);
                      setCta(res.cta);
                      save({ body: res.body, cta: res.cta });
                      toast.success("Draft added — read it over before it goes anywhere.");
                    }
                  });
                }}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-white hover:bg-accent-hi disabled:opacity-60"
              >
                <IconSparkles size={12} />
                {savingContext ? "Drafting…" : "Save & draft"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* ---- Everything about the video ---- */}
      <aside className="min-w-0 space-y-4">
        <section className="rounded-2xl border border-line bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Spoken brief</h2>
          <p className="mb-2.5 text-xs leading-relaxed text-ink-3">
            Faster than typing. Record the idea, then turn it into text you can shape.
          </p>

          {recording ? (
            <VoiceRecorder onDone={onVoiceDone} onCancel={() => setRecording(false)} />
          ) : voiceUrl ? (
            <div className="space-y-2">
              <VoicePlayer src={voiceUrl} duration={voiceMeta.duration} peaks={voiceMeta.peaks} />
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={transcribing}
                  onClick={() => {
                    setTranscribing(true);
                    startTransition(async () => {
                      const res = await transcribeBriefAction(video.id);
                      setTranscribing(false);
                      if (res?.error) toast.error(res.error);
                      else if (res?.text) {
                        // Appended, never overwriting what's already written.
                        const next = body ? `${body}\n\n${res.text}` : res.text;
                        setBody(next);
                        save({ body: next });
                        toast.success("Transcript added to the body.");
                      }
                    });
                  }}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-accent-hi disabled:opacity-50"
                >
                  <IconSparkles size={12} />
                  {transcribing ? "Transcribing…" : "Turn into text"}
                </button>
                <button
                  type="button"
                  disabled={structuring}
                  title="Split the recording straight into a hook, body and CTA instead of one raw paragraph"
                  onClick={() => {
                    setStructuring(true);
                    startTransition(async () => {
                      const res = await structureBriefAction(video.id);
                      setStructuring(false);
                      if (res?.error) toast.error(res.error);
                      else if (res?.ok) {
                        const nextHooks = res.hooks.length ? [...hooks, ...res.hooks] : hooks;
                        const nextBody = res.body ? (body ? `${body}\n\n${res.body}` : res.body) : body;
                        const nextCta = cta || res.cta;
                        setHooks(nextHooks);
                        setBody(nextBody);
                        setCta(nextCta);
                        save({ hooks: nextHooks, body: nextBody, cta: nextCta });
                        toast.success("Structured into hook / body / CTA below.");
                      }
                    });
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
                >
                  <IconSparkles size={12} />
                  {structuring ? "Structuring…" : "Structure into script"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    startTransition(async () => {
                      const res = await saveBriefVoiceAction(video.id, null);
                      if (res?.error) toast.error(res.error);
                      else {
                        setVoiceUrl(null);
                        router.refresh();
                      }
                    })
                  }
                  className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-2 hover:text-danger"
                >
                  <IconTrash size={12} />
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setRecording(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong py-3 text-xs text-ink-2 hover:border-accent hover:text-ink"
            >
              <IconMic size={14} />
              Record a brief
            </button>
          )}
        </section>

        {video.idea_notes ? (
          <details className="rounded-2xl border border-line bg-card p-4">
            <summary className="cursor-pointer text-sm font-semibold">
              From ideation
              <span className="ml-2 font-normal text-[11px] text-ink-3">
                what you were thinking
              </span>
            </summary>
            <p className="mt-2.5 whitespace-pre-wrap text-xs leading-relaxed text-ink-2">
              {video.idea_notes}
            </p>
          </details>
        ) : null}

        <HookLibrary
          snippets={snippets}
          currentHooks={hooks}
          videoId={video.id}
          onInsert={(text) => {
            const next = [...hooks, text];
            setHooks(next);
            save({ hooks: next });
          }}
        />

        <section className="rounded-2xl border border-line bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Written brief</h2>
          <textarea
            value={brief}
            rows={5}
            placeholder="Context for the editor."
            onChange={(e) => setBrief(e.target.value)}
            onBlur={(e) => {
              if (e.target.value === (video.brief ?? "")) return;
              const value = e.target.value;
              startTransition(async () => {
                const res = await updateVideoAction(video.id, { brief: value.trim() || null });
                if (res?.error) toast.error(res.error);
              });
            }}
            className="w-full resize-y rounded-lg bg-panel px-2.5 py-2 text-sm leading-relaxed placeholder:text-ink-3 focus:outline-none"
          />
        </section>

        <section className="space-y-3 rounded-2xl border border-line bg-card p-4">
          <h2 className="text-sm font-semibold">Details</h2>
          <TaxonomyMultiSelect
            kind="content_pillar"
            selected={video.content_pillars}
            customs={customs.content_pillar}
            onChange={(content_pillars) =>
              startTransition(async () => {
                await updateVideoAction(video.id, { content_pillars });
                router.refresh();
              })
            }
          />
          <TaxonomyMultiSelect
            kind="format"
            selected={video.formats}
            customs={customs.format}
            onChange={(formats) =>
              startTransition(async () => {
                await updateVideoAction(video.id, { formats });
                router.refresh();
              })
            }
          />
          <TaxonomyMultiSelect
            kind="platform"
            selected={video.platforms}
            customs={customs.platform}
            onChange={(platforms) =>
              startTransition(async () => {
                await updateVideoAction(video.id, { platforms });
                router.refresh();
              })
            }
          />
        </section>
      </aside>

      {prompting ? (
        <Teleprompter
          hook={hooks[0] ?? null}
          body={body}
          cta={cta}
          onClose={() => setPrompting(false)}
        />
      ) : null}
    </div>
  );
}
