"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { ShotCard } from "@/components/library/VisualsBrowser";
import { IconSparkles } from "@/components/ui/icons";
import {
  generateCarouselSlideAction,
  setSlideImageFromShotAction,
  type SlideLayout,
} from "@/app/carousel-actions";
import { getLibraryShotsByIds, searchLibraryShots } from "@/app/library-visuals-actions";
import type { CarouselImage, LibraryShot } from "@/lib/types";

interface PanelState {
  shot: LibraryShot | null;
  text: string;
}

const LAYOUTS: { key: SlideLayout; label: string; hint: string }[] = [
  { key: "full", label: "One image", hint: "Fills the whole frame" },
  { key: "top-bottom", label: "Top / bottom", hint: "Two panels, stacked" },
  { key: "left-right", label: "Left / right", hint: "Two panels, side by side" },
];

/**
 * The confirmation step before anything is sent to OpenAI.
 *
 * A mock-up of the slide: which photo is in which panel, which text sits on
 * which panel, and how they're laid out. Everything can be rearranged or
 * swapped here, a different photo can be searched for and dropped in, and
 * only pressing Confirm makes the (paid) image request — with exactly this
 * arrangement. Nothing is generated on the way in.
 */
export function SlideDesigner({
  slide,
  index,
  videoId,
  onClose,
}: {
  slide: CarouselImage;
  index: number;
  videoId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTrackedTransition();

  const lines = (slide.caption ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const refIds = slide.ref_shot_ids ?? [];
  const [layout, setLayout] = useState<SlideLayout>(refIds.length >= 2 ? "top-bottom" : "full");
  const [panels, setPanels] = useState<PanelState[]>([
    { shot: null, text: refIds.length >= 2 && lines.length > 1 ? lines[0] : lines.join("\n") },
    { shot: null, text: refIds.length >= 2 && lines.length > 1 ? lines.slice(1).join("\n") : "" },
  ]);
  const [active, setActive] = useState(0);
  const [note, setNote] = useState("");
  const [picking, setPicking] = useState<number | null>(null);

  // The photos already pinned to the slide arrive as ids; fetch them to show.
  useEffect(() => {
    let cancelled = false;
    if (!refIds.length) return;
    getLibraryShotsByIds(refIds.slice(0, 2)).then((shots) => {
      if (cancelled) return;
      setPanels((p) => p.map((panel, i) => ({ ...panel, shot: shots[i] ?? panel.shot })));
    });
    return () => {
      cancelled = true;
    };
    // Runs once for whatever the slide had when the designer opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = layout === "full" ? 1 : 2;
  const set = (i: number, patch: Partial<PanelState>) =>
    setPanels((p) => p.map((panel, j) => (j === i ? { ...panel, ...patch } : panel)));

  function pickLayout(next: SlideLayout) {
    setLayout(next);
    if (next !== "full") {
      // Going to two panels: if the text runs to several lines and panel 2 is
      // empty, give the later lines to it rather than leaving it blank.
      setPanels((p) => {
        if (p[1].text.trim() || !p[0].text.includes("\n")) return p;
        const [first, ...rest] = p[0].text.split("\n");
        return [
          { ...p[0], text: first },
          { ...p[1], text: rest.join("\n") },
        ];
      });
    } else {
      setActive(0);
    }
  }

  const swapImages = () => setPanels((p) => [{ ...p[0], shot: p[1].shot }, { ...p[1], shot: p[0].shot }]);
  const swapText = () => setPanels((p) => [{ ...p[0], text: p[1].text }, { ...p[1], text: p[0].text }]);

  function confirm() {
    startTransition(async () => {
      const res = await generateCarouselSlideAction(slide.id, videoId, {
        layout,
        panels: panels.slice(0, shown).map((p) => ({ shotId: p.shot?.id ?? null, text: p.text })),
        note,
      });
      if (res?.error) toast.error(res.error);
      else {
        toast.success(`Slide ${index + 1} designed.`);
        router.refresh();
        onClose();
      }
    });
  }

  function useAsIs() {
    const shot = panels[0].shot;
    if (!shot) return;
    startTransition(async () => {
      const res = await setSlideImageFromShotAction(slide.id, videoId, shot.id);
      if (res?.error) toast.error(res.error);
      else {
        toast.success(`Slide ${index + 1} set from the footage index.`);
        router.refresh();
        onClose();
      }
    });
  }

  const ready = panels.slice(0, shown).some((p) => p.text.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-line bg-card p-4 sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">Design slide {index + 1}</h3>
            <p className="text-xs text-ink-3">
              Check the arrangement, then confirm. Nothing is sent to OpenAI until you press Confirm.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:bg-hover"
          >
            Cancel
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
          {/* The mock-up */}
          <div>
            <div
              className={`flex aspect-[2/3] w-full overflow-hidden rounded-lg border border-line bg-black ${
                layout === "left-right" ? "flex-row" : "flex-col"
              }`}
            >
              {panels.slice(0, shown).map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActive(i)}
                  className={`relative min-h-0 min-w-0 flex-1 overflow-hidden text-left ${
                    active === i ? "ring-2 ring-inset ring-accent" : ""
                  } ${i > 0 ? (layout === "left-right" ? "border-l border-black" : "border-t border-black") : ""}`}
                >
                  {p.shot?.thumb_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.shot.thumb_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center bg-app px-2 text-center text-[10px] text-ink-3">
                      No photo — a background will be designed
                    </span>
                  )}
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 pt-6">
                    <span className="line-clamp-4 whitespace-pre-wrap text-[11px] font-semibold leading-tight text-white">
                      {p.text.trim() || "(no text)"}
                    </span>
                  </span>
                  <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white">
                    {layout === "full" ? "Image" : layout === "top-bottom" ? (i === 0 ? "Top" : "Bottom") : i === 0 ? "Left" : "Right"}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-center text-[10px] text-ink-3">Click a panel to edit it</p>
          </div>

          {/* Controls */}
          <div className="min-w-0 space-y-3">
            <div>
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                Layout
              </span>
              <div className="flex flex-wrap gap-1.5">
                {LAYOUTS.map((l) => (
                  <button
                    key={l.key}
                    type="button"
                    onClick={() => pickLayout(l.key)}
                    aria-pressed={layout === l.key}
                    title={l.hint}
                    className={`rounded-md px-2.5 py-1.5 text-xs ${
                      layout === l.key
                        ? "bg-accent text-white"
                        : "border border-line text-ink-2 hover:border-accent hover:text-ink"
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            {shown === 2 ? (
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={swapImages}
                  className="rounded-md border border-line px-2.5 py-1.5 text-[11px] text-ink-2 hover:border-accent hover:text-ink"
                >
                  Swap the two images
                </button>
                <button
                  type="button"
                  onClick={swapText}
                  className="rounded-md border border-line px-2.5 py-1.5 text-[11px] text-ink-2 hover:border-accent hover:text-ink"
                >
                  Swap the two texts
                </button>
              </div>
            ) : null}

            <div className="space-y-2 rounded-xl border border-line bg-raised p-2.5">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                {shown === 1 ? "The image" : layout === "top-bottom" ? (active === 0 ? "Top panel" : "Bottom panel") : active === 0 ? "Left panel" : "Right panel"}
              </span>
              <textarea
                value={panels[active].text}
                rows={3}
                onChange={(e) => set(active, { text: e.target.value })}
                placeholder="The text on this panel"
                className="w-full resize-y rounded-md border border-line bg-app px-2 py-1.5 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPicking(active)}
                  className="rounded-md border border-line px-2.5 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink"
                >
                  {panels[active].shot ? "Choose a different image" : "Choose an image"}
                </button>
                {panels[active].shot ? (
                  <button
                    type="button"
                    onClick={() => set(active, { shot: null })}
                    className="rounded-md px-2 py-1.5 text-xs text-ink-3 hover:bg-hover hover:text-danger"
                  >
                    Remove image
                  </button>
                ) : null}
              </div>
              {panels[active].shot ? (
                <p className="line-clamp-2 text-[11px] text-ink-3">{panels[active].shot?.caption}</p>
              ) : null}
            </div>

            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder='Extra direction (optional) — "bigger text, warmer tones"'
              className="w-full rounded-md border border-line bg-app px-2 py-1.5 text-xs placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {layout === "full" && panels[0].shot ? (
            <button
              type="button"
              disabled={pending}
              onClick={useAsIs}
              title="Put the photo on the slide as it is — no AI, no cost"
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
            >
              Use the photo as-is (free)
            </button>
          ) : null}
          <span className="ml-auto text-[11px] text-ink-3">Confirming sends this to OpenAI and uses credit.</span>
          <button
            type="button"
            disabled={pending || !ready}
            onClick={confirm}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hi disabled:opacity-50"
          >
            <IconSparkles size={14} />
            {pending ? "Designing…" : "Confirm & generate"}
          </button>
        </div>
      </div>

      {picking !== null ? (
        <ImagePicker
          initialQuery={panels[picking].text}
          onClose={() => setPicking(null)}
          onPick={(shot) => {
            set(picking, { shot });
            setPicking(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** Search the footage index for a different image to drop into a panel. */
function ImagePicker({
  initialQuery,
  onClose,
  onPick,
}: {
  initialQuery: string;
  onClose: () => void;
  onPick: (shot: LibraryShot) => void;
}) {
  const [q, setQ] = useState(initialQuery.replace(/\s+/g, " ").slice(0, 120));
  const [frames, setFrames] = useState(false);
  const [results, setResults] = useState<LibraryShot[] | null>(null);
  const [busy, setBusy] = useState(false);

  function search(query: string, includeFrames: boolean) {
    setBusy(true);
    searchLibraryShots({ q: query, media: includeFrames ? "" : "image", limit: 12 }).then((r) => {
      setResults(r);
      setBusy(false);
    });
  }

  // First search runs as the picker opens, from the panel's own text.
  useEffect(() => {
    let cancelled = false;
    searchLibraryShots({ q: initialQuery.slice(0, 120), media: "image", limit: 12 }).then((r) => {
      if (!cancelled) setResults(r);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-3" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-card p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            search(q, frames);
          }}
          className="mb-3 flex flex-wrap items-center gap-2"
        >
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the footage index — what's in the shot?"
            className="min-w-0 flex-1 rounded-lg border border-line-strong bg-raised px-3 py-2 text-sm outline-none placeholder:text-ink-3 focus:border-accent"
          />
          <button type="submit" className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hi">
            Search
          </button>
          <button type="button" onClick={onClose} className="rounded-lg border border-line px-3 py-2 text-sm text-ink-2 hover:bg-hover">
            Close
          </button>
          <label className="flex w-full items-center gap-1.5 text-[11px] text-ink-3">
            <input
              type="checkbox"
              checked={frames}
              onChange={(e) => {
                setFrames(e.target.checked);
                search(q, e.target.checked);
              }}
              className="h-3.5 w-3.5 accent-[var(--color-accent)]"
            />
            Also show a still from each video clip (the frame the librarian saved for it)
          </label>
        </form>
        {results === null || busy ? (
          <p className="py-8 text-center text-sm text-ink-3">Searching…</p>
        ) : results.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-3">Nothing matched — try fewer words.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {results.map((shot) => (
              <ShotCard
                key={shot.id}
                shot={shot}
                action={
                  <button
                    type="button"
                    onClick={() => onPick(shot)}
                    className="rounded-md bg-accent px-2 py-1 text-[10px] font-medium text-white hover:bg-accent-hi"
                  >
                    Use here
                  </button>
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
