"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import {
  createCarouselSlideAction,
  deleteCarouselImageAction,
  generateCarouselSlideAction,
  moveCarouselImageAction,
  saveCarouselStyleAction,
  setSlideRefsAction,
  updateCarouselCaptionAction,
} from "@/app/carousel-actions";
import { suggestSlideVisualsAction } from "@/app/library-visuals-actions";
import { ShotCard } from "@/components/library/VisualsBrowser";
import { IconChevronDown, IconPlus, IconSparkles, IconTrash } from "@/components/ui/icons";
import type { CarouselImage, LibraryShot } from "@/lib/types";

/**
 * A carousel's script isn't one body of text — it's one caption per slide,
 * written here at the scripting stage. From here each slide's image can be
 * GENERATED from that text (gpt-image-1): the carousel-wide style box is the
 * shared art direction, footage-index shots can be pinned as references so
 * the design grounds itself in the client's real material, and a finished
 * slide regenerates with a plain-English change note instead of starting
 * over. Uploading by hand (the editor path) still works — same slots.
 */
export function CarouselSlides({
  videoId,
  slides,
  carouselStyle,
}: {
  videoId: string;
  slides: CarouselImage[];
  carouselStyle?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTrackedTransition();
  const [adding, setAdding] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);

  const missing = slides.filter((s) => (s.caption ?? "").trim() && !s.storage_path);

  function generateAllMissing() {
    setBatchRunning(true);
    startTransition(async () => {
      let made = 0;
      // Sequential on purpose: each generation is slow and the carousel
      // should stay one consistent series, not four parallel guesses.
      for (const s of missing) {
        const res = await generateCarouselSlideAction(s.id, videoId);
        if (res?.error) {
          toast.error(`Slide ${slides.indexOf(s) + 1}: ${res.error}`);
          break;
        }
        made += 1;
        router.refresh();
      }
      setBatchRunning(false);
      if (made > 0) toast.success(`Generated ${made} slide${made === 1 ? "" : "s"}.`);
    });
  }

  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold">Slides</h2>
        <span className="text-xs text-ink-3">{slides.length}</span>
        {missing.length > 0 ? (
          <button
            type="button"
            disabled={pending || batchRunning}
            onClick={generateAllMissing}
            className="ml-auto flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
          >
            <IconSparkles size={12} />
            {batchRunning ? "Designing…" : `Generate ${missing.length} missing`}
          </button>
        ) : null}
        <button
          type="button"
          disabled={adding}
          onClick={() => {
            setAdding(true);
            startTransition(async () => {
              const res = await createCarouselSlideAction(videoId);
              setAdding(false);
              if (res?.error) toast.error(res.error);
              else router.refresh();
            });
          }}
          className={`${missing.length > 0 ? "" : "ml-auto "}flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50`}
        >
          <IconPlus size={12} />
          Add slide
        </button>
      </div>

      <p className="mb-2 text-xs leading-relaxed text-ink-3">
        One line per slide — the text that goes on the image itself. Generate the image from it, or
        upload one later in the same order.
      </p>

      {/* Carousel-wide art direction, applied to every generated slide. */}
      <textarea
        defaultValue={carouselStyle ?? ""}
        rows={2}
        placeholder='Style for the whole carousel — e.g. "off-white paper background, bold black serif, one red underline accent, editorial"'
        onBlur={(e) => {
          if (e.target.value === (carouselStyle ?? "")) return;
          startTransition(async () => {
            const res = await saveCarouselStyleAction(videoId, e.target.value);
            if (res?.error) toast.error(res.error);
            else toast.success("Style saved — new generations will use it.");
          });
        }}
        className="mb-3 w-full resize-none rounded-lg border border-dashed border-line bg-app px-2.5 py-2 text-xs placeholder:text-ink-3 focus:border-accent focus:outline-none"
      />

      {slides.length ? (
        <div className="space-y-2">
          {slides.map((s, i) => (
            <SlideRow key={s.id} slide={s} index={i} count={slides.length} videoId={videoId} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-ink-3">No slides yet — add the first one.</p>
      )}
    </section>
  );
}

function SlideRow({
  slide: s,
  index: i,
  count,
  videoId,
}: {
  slide: CarouselImage;
  index: number;
  count: number;
  videoId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTrackedTransition();
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [picker, setPicker] = useState<LibraryShot[] | null>(null);
  const [refs, setRefs] = useState<string[]>(s.ref_shot_ids ?? []);
  const [generating, setGenerating] = useState(false);

  const hasText = Boolean((s.caption ?? "").trim());

  function generate(changeNote?: string) {
    setGenerating(true);
    startTransition(async () => {
      const res = await generateCarouselSlideAction(s.id, videoId, changeNote);
      setGenerating(false);
      if (res?.error) toast.error(res.error);
      else {
        setNote("");
        setShowNote(false);
        toast.success(`Slide ${i + 1} designed.`);
        router.refresh();
      }
    });
  }

  function openPicker() {
    startTransition(async () => {
      const shots = await suggestSlideVisualsAction(s.caption ?? "");
      if (shots.length === 0) toast.error("Footage index is empty — sync the librarian first.");
      else setPicker(shots);
    });
  }

  function toggleRef(id: string) {
    const next = refs.includes(id) ? refs.filter((r) => r !== id) : [...refs, id].slice(0, 4);
    setRefs(next);
    startTransition(async () => {
      const res = await setSlideRefsAction(s.id, videoId, next);
      if (res?.error) toast.error(res.error);
    });
  }

  return (
    <div className="rounded-lg border border-line bg-raised p-2">
      <div className="flex gap-2">
        <span className="mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-app text-[10px] text-ink-3">
          {i + 1}
        </span>

        {s.signed_url ? (
          // Signed Storage URL (short-lived) — plain <img>, as everywhere else.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={s.signed_url}
            alt={`Slide ${i + 1}`}
            className="h-16 w-[52px] shrink-0 rounded-md border border-line object-cover"
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <textarea
            defaultValue={s.caption ?? ""}
            rows={2}
            placeholder={`Slide ${i + 1} text…`}
            onBlur={(e) => {
              if (e.target.value === (s.caption ?? "")) return;
              startTransition(async () => {
                const res = await updateCarouselCaptionAction(s.id, videoId, e.target.value);
                if (res?.error) toast.error(res.error);
              });
            }}
            className="w-full resize-none rounded-md bg-app px-2 py-1.5 text-xs placeholder:text-ink-3 focus:outline-none"
          />

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {!s.storage_path ? (
              <button
                type="button"
                disabled={pending || !hasText}
                title={hasText ? "Design this slide from its text" : "Write the slide text first"}
                onClick={() => generate()}
                className="flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[10px] font-medium text-white hover:bg-accent-hi disabled:opacity-40"
              >
                <IconSparkles size={11} />
                {generating ? "Designing…" : "Generate"}
              </button>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => setShowNote((v) => !v)}
                className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[10px] text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
              >
                <IconSparkles size={11} />
                Regenerate…
              </button>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={openPicker}
              className="rounded-md border border-line px-2 py-1 text-[10px] text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
            >
              {refs.length ? `References (${refs.length})` : "Suggest visuals"}
            </button>
            {s.gen_at ? (
              <span className="text-[9px] text-ink-3" title={s.gen_prompt ?? undefined}>
                AI · {new Date(s.gen_at).toLocaleDateString()}
              </span>
            ) : null}
          </div>

          {showNote ? (
            <div className="mt-1.5 flex gap-1.5">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder='What should change? — "bigger text, warmer background, drop the icon"'
                className="min-w-0 flex-1 rounded-md border border-line bg-app px-2 py-1 text-[11px] placeholder:text-ink-3 focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                disabled={pending || !note.trim()}
                onClick={() => generate(note)}
                className="shrink-0 rounded-md bg-accent px-2 py-1 text-[10px] font-medium text-white hover:bg-accent-hi disabled:opacity-40"
              >
                {generating ? "Designing…" : "Go"}
              </button>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-center gap-0.5">
          <button
            type="button"
            disabled={i === 0}
            title="Move earlier"
            onClick={() =>
              startTransition(async () => {
                await moveCarouselImageAction(s.id, videoId, "left");
                router.refresh();
              })
            }
            className="rotate-180 rounded p-1 text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-30"
          >
            <IconChevronDown size={12} />
          </button>
          <button
            type="button"
            disabled={i === count - 1}
            title="Move later"
            onClick={() =>
              startTransition(async () => {
                await moveCarouselImageAction(s.id, videoId, "right");
                router.refresh();
              })
            }
            className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-30"
          >
            <IconChevronDown size={12} />
          </button>
          <button
            type="button"
            title="Delete slide"
            onClick={() =>
              startTransition(async () => {
                const res = await deleteCarouselImageAction(s.id, videoId);
                if (res?.error) toast.error(res.error);
                else router.refresh();
              })
            }
            className="rounded p-1 text-ink-3 hover:bg-hover hover:text-danger"
          >
            <IconTrash size={11} />
          </button>
        </div>
      </div>

      {picker ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPicker(null)}>
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-card p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">Visuals for slide {i + 1}</h3>
                <p className="text-xs text-ink-3">
                  From the footage index — pick up to 4 frames to ground the design in.
                </p>
              </div>
              <button
                onClick={() => setPicker(null)}
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink"
              >
                Done
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {picker.map((shot) => (
                <ShotCard
                  key={shot.id}
                  shot={shot}
                  action={
                    <button
                      onClick={() => toggleRef(shot.id)}
                      className={`rounded-md px-2 py-1 text-[10px] font-medium ${
                        refs.includes(shot.id)
                          ? "bg-accent text-white"
                          : "border border-line text-ink-2 hover:border-accent hover:text-ink"
                      }`}
                    >
                      {refs.includes(shot.id) ? "Referenced ✓" : "Use"}
                    </button>
                  }
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
