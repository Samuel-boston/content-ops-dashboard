"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { TaxonomyMultiSelect } from "@/components/TaxonomyMultiSelect";
import { StageMove } from "@/components/pipeline/StageMove";
import { StageBack } from "@/components/pipeline/StageBack";
import { PlanningStageBar } from "@/components/pipeline/PlanningStageBar";
import { Teleprompter } from "@/components/script/Teleprompter";
import { VideoReferences } from "@/components/VideoReferences";
import { ScriptComments } from "@/components/script/ScriptComments";
import { CarouselSlides } from "@/components/script/CarouselSlides";
import { isCarouselFormat } from "@/lib/taxonomy";
import {
  IconCheck,
  IconChart,
  IconChevronRight,
  IconGrip,
  IconPlus,
  IconSparkles,
  IconX,
} from "@/components/ui/icons";
import { saveScriptAction } from "@/app/script-actions";
import { approveCarouselScriptAction, scriptDoneAction } from "@/app/pipeline-actions";
import { updateVideoAction } from "@/app/actions";
import { readTime } from "@/lib/format";
import { PLANNING_STAGES, type CarouselImage, type Profile, type ReferenceItem, type ScriptComment, type Video } from "@/lib/types";
import { ParkButton } from "@/components/pipeline/ParkButton";
import { ThumbnailPanel } from "@/components/workspace/ThumbnailPanel";

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
  carouselSlides,
  references,
  comments,
  chat,
}: {
  video: Video;
  viewer: Profile;
  customs: { content_pillar: string[]; format: string[]; platform: string[] };
  carouselSlides: CarouselImage[];
  references: ReferenceItem[];
  comments: ScriptComment[];
  chat?: React.ReactNode;
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

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [prompting, setPrompting] = useState(false);
  // Words selected in the body, so a note can be pinned to exactly them.
  const [bodyQuote, setBodyQuote] = useState<string | null>(null);
  const openNotes = comments.filter((c) => !c.resolved).length;

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

  const variantsExpected = hooks.length > 1;
  const isClient = viewer.role === "owner" || viewer.role === "admin";
  // The stepper is usable by the copywriter too — the database refuses the one
  // move that's the client's call (approving for filming), which the bar also greys out.
  const canEditStage = isClient;
  const canSubmitForReview = viewer.role === "copywriter";
  const carousel = isCarouselFormat(video.formats);
  // Come back to the list you most likely arrived from.
  const [backHref, backLabel] =
    video.status === "ready_to_film"
      ? (["/filming", "Filming"] as const)
      : video.status === "ideation"
        ? (["/ideation", "Ideation"] as const)
        : (["/board", "Board"] as const);

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
            {isClient ? <ParkButton videoId={video.id} parked={Boolean(video.parked_at)} compact /> : null}
            {/* Only once there's a cut to review — before that, /videos/[id]
                just bounces back to this room, which read as a dead button. */}
            {!PLANNING_STAGES.includes(video.status) ? (
              <Link
                href={`/videos/${video.id}`}
                className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 hover:bg-hover hover:text-ink"
              >
                Video review →
              </Link>
            ) : null}
          </div>
          <PlanningStageBar
            videoId={video.id}
            current={video.status}
            canEdit={isClient || viewer.role === "copywriter"}
            carousel={carousel}
            lockedStages={viewer.role === "copywriter" ? ["ready_to_film"] : []}
          />
          {video.status !== "ideation" ? (
            <div className="flex min-h-[2.75rem] flex-wrap items-center gap-2 rounded-xl border border-line bg-card px-3 py-2">
              <span className="text-[11px] text-ink-3">Next step</span>
              {openNotes > 0 ? (
                <span className="rounded-md bg-warn/15 px-1.5 py-0.5 text-[10px] font-medium text-warn">
                  {openNotes} open note{openNotes === 1 ? "" : "s"} on the script
                </span>
              ) : null}
          {video.status === "scripting" && canEditStage ? (
                <div className="ml-auto flex items-center gap-1">
                  <StageBack videoId={video.id} status={video.status} />
                  {carousel ? (
                    <button
                      type="button"
                      onClick={() =>
                        startTransition(async () => {
                          const res = await approveCarouselScriptAction(video.id);
                          if (res?.error) toast.error(res.error);
                          else router.push(`/videos/${video.id}`);
                        })
                      }
                      className="flex shrink-0 items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white transition hover:bg-accent-hi disabled:opacity-50"
                    >
                      Script done — needs creatives
                      <IconChevronRight size={11} />
                    </button>
                  ) : (
                    <StageMove
                      videoId={video.id}
                      to="ready_to_film"
                      label="Script done — ready to film"
                      goTo={`/videos/${video.id}/film`}
                    />
                  )}
                </div>
              ) : video.status === "scripting" && canSubmitForReview ? (
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      startTransition(async () => {
                        const res = await scriptDoneAction(video.id);
                        if (res?.error) toast.error(res.error);
                        else toast.success("Told the client it's ready.");
                      })
                    }
                    className="flex shrink-0 items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white transition hover:bg-accent-hi disabled:opacity-50"
                  >
                    Script done — tell the client
                    <IconChevronRight size={11} />
                  </button>
                </div>
              ) : video.status === "ready_to_film" && canEditStage ? (
                <div className="ml-auto flex items-center gap-1">
                  <StageBack videoId={video.id} status={video.status} />
                  <StageMove
                    videoId={video.id}
                    to="ready_to_edit"
                    label="Filmed — send to editors"
                    goTo={`/videos/${video.id}`}
                  />
                </div>
              ) : video.status === "ready_to_edit" ? (
                <span className="ml-auto flex items-center gap-1.5 text-xs text-ok">
                  <IconCheck size={13} />
                  With the editors
                </span>
              ) : null}
                </div>
          ) : null}
        </div>

        <ThumbnailPanel videoId={video.id} />

        {isCarouselFormat(video.formats) ? (
          <CarouselSlides
            videoId={video.id}
            slides={carouselSlides}
            carouselStyle={video.carousel_style}
            comments={comments}
            viewer={viewer}
          />
        ) : (
          <>
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
          <div className="space-y-1.5">
            {hooks.map((h, i) => (
              <div key={`${i}-${h.slice(0, 12)}`}>
              <div
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
              <ScriptComments
                videoId={video.id}
                target={`hook:${i}`}
                comments={comments}
                viewer={viewer}
                compact
                label={`Comment on hook ${i + 1}`}
              />
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
          </div>

          <textarea
            value={body}
            rows={14}
            placeholder="The middle of the video — what actually gets said."
            onChange={(e) => {
              setBody(e.target.value);
              setDirty(true);
              setBodyQuote(null);
            }}
            onSelect={(e) => {
              const el = e.currentTarget;
              setBodyQuote(
                el.selectionEnd > el.selectionStart
                  ? body.slice(el.selectionStart, el.selectionEnd).trim() || null
                  : null
              );
            }}
            onBlur={() => dirty && save()}
            className="w-full resize-y bg-transparent text-sm leading-relaxed placeholder:text-ink-3 focus:outline-none"
          />
          <ScriptComments
            videoId={video.id}
            target="body"
            comments={comments}
            viewer={viewer}
            quote={bodyQuote}
            onQuoteUsed={() => setBodyQuote(null)}
            label="Comment on the body"
          />
        </section>

        {/* CTA */}
        <section className="rounded-2xl border border-line bg-card p-4">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-sm font-semibold">Call to action</h2>
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
          <ScriptComments
            videoId={video.id}
            target="cta"
            comments={comments}
            viewer={viewer}
            label="Comment on the call to action"
          />
        </section>
          </>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {!isCarouselFormat(video.formats) ? (
            <>
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
            </>
          ) : null}
        </div>

      </div>

      {/* ---- Everything about the video ---- */}
      <aside className="min-w-0 space-y-4">
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

        {/* References added back in Ideation follow the video into every stage. */}
        <section className="rounded-2xl border border-line bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">References</h2>
          <VideoReferences videoId={video.id} items={references} />
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

        {chat}
      </aside>

      {prompting ? (
        <Teleprompter
          hooks={hooks}
          body={body}
          onClose={() => setPrompting(false)}
        />
      ) : null}
    </div>
  );
}
