"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import {
  createCarouselSlideAction,
  deleteCarouselImageAction,
  moveCarouselImageAction,
  updateCarouselCaptionAction,
} from "@/app/carousel-actions";
import { IconChevronDown, IconPlus, IconTrash } from "@/components/ui/icons";
import type { CarouselImage } from "@/lib/types";

/**
 * A carousel's script isn't one body of text — it's one caption per slide.
 * Written here, at the scripting stage, often before any image exists (an
 * image just joins the same row later, matched by position). Kept separate
 * from the hook/body/CTA above: those are still the post's own caption text,
 * this is what's written ON each slide.
 */
export function CarouselSlides({ videoId, slides }: { videoId: string; slides: CarouselImage[] }) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTrackedTransition();
  const [adding, setAdding] = useState(false);

  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold">Slides</h2>
        <span className="text-xs text-ink-3">{slides.length}</span>
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
          className="ml-auto flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
        >
          <IconPlus size={12} />
          Add slide
        </button>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-ink-3">
        One line per slide — the text that goes on the image itself. Images get uploaded later, in
        this same order.
      </p>

      {slides.length ? (
        <div className="space-y-2">
          {slides.map((s, i) => (
            <div key={s.id} className="flex gap-2 rounded-lg border border-line bg-raised p-2">
              <span className="mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-app text-[10px] text-ink-3">
                {i + 1}
              </span>
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
                className="min-w-0 flex-1 resize-none rounded-md bg-app px-2 py-1.5 text-xs placeholder:text-ink-3 focus:outline-none"
              />
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
                  disabled={i === slides.length - 1}
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
          ))}
        </div>
      ) : (
        <p className="text-xs text-ink-3">No slides yet — add the first one.</p>
      )}
    </section>
  );
}
