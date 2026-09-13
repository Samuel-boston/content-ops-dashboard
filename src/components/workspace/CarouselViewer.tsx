"use client";

import { useState } from "react";
import type { CarouselImage } from "@/lib/types";

/**
 * Sits where PlayerPane would for every other format — "Carousel with text"
 * has no cut to scrub, just a sequence of images to page through.
 */
export function CarouselViewer({ images }: { images: CarouselImage[] }) {
  const [i, setI] = useState(0);

  if (images.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-app text-sm text-ink-3">
        No images uploaded yet.
      </div>
    );
  }

  const index = Math.min(i, images.length - 1);
  const img = images[index];

  return (
    <div className="relative flex h-full flex-col items-center justify-center bg-app">
      {img.signed_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={img.signed_url}
          alt={`Slide ${index + 1} of ${images.length}`}
          className="max-h-full max-w-full object-contain"
        />
      ) : (
        <span className="text-sm text-ink-3">Image unavailable.</span>
      )}

      {img.caption?.trim() ? (
        <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-6 pb-5 pt-8 text-center text-sm font-medium leading-snug text-white">
          {img.caption}
        </p>
      ) : null}

      {images.length > 1 ? (
        <>
          <button
            type="button"
            onClick={() => setI((n) => (n - 1 + images.length) % images.length)}
            aria-label="Previous image"
            className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-lg text-white hover:bg-black/70"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setI((n) => (n + 1) % images.length)}
            aria-label="Next image"
            className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-lg text-white hover:bg-black/70"
          >
            ›
          </button>
          <div className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white">
            {index + 1} / {images.length}
          </div>
        </>
      ) : null}
    </div>
  );
}
