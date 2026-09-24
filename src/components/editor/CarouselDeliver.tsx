"use client";

import { sendWithProgress } from "@/lib/upload-progress";
import { UploadStatus, type UploadState } from "@/components/ui/UploadStatus";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import {
  createCarouselUploadUrlAction,
  deleteCarouselImageAction,
  moveCarouselImageAction,
  registerCarouselImageAction,
  updateCarouselCaptionAction,
} from "@/app/carousel-actions";
import { IconChevronDown } from "@/components/ui/icons";
import type { CarouselImage } from "@/lib/types";

/**
 * Carousel posts are a sequence of images, not a cut — this skips Cloudflare
 * Stream entirely and uploads straight to Supabase Storage, same as footage.
 * Drop several at once; each just appears as the next slide.
 */
export function CarouselDeliver({ videoId, images }: { videoId: string; images: CarouselImage[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [, startTransition] = useTrackedTransition();
  const [upload, setUpload] = useState<UploadState | null>(null);
  const uploading = upload?.phase === "uploading" ? upload : null;

  async function uploadOne(file: File, onProgress: (pct: number) => void) {
    const res = await createCarouselUploadUrlAction(videoId, file.name);
    if (!res?.ok) throw new Error(res?.error ?? "Could not start upload.");
    await sendWithProgress(res.signedUrl, file, { method: "PUT", headers: { "x-upsert": "true" }, onProgress });
    const r = await registerCarouselImageAction({ videoId, storagePath: res.path, sizeBytes: file.size });
    if (r?.error) throw new Error(r.error);
  }

  async function uploadFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    const title = files.length === 1 ? "Carousel image" : `${files.length} carousel images`;
    try {
      for (const [i, f] of files.entries()) {
        const step = files.length > 1 ? `Image ${i + 1} of ${files.length}` : undefined;
        setUpload({ phase: "uploading", title, pct: 0, step, detail: f.name });
        await uploadOne(f, (pct) => setUpload({ phase: "uploading", title, pct, step, detail: f.name }));
      }
      setUpload({ phase: "done", title, detail: "Added to the carousel." });
      router.refresh();
    } catch (e) {
      setUpload({ phase: "error", title, detail: (e as Error).message });
    }
  }

  return (
    <div className="space-y-2.5">
      {images.length > 0 ? (
        <div className="space-y-2">
          {images.map((img, i) => (
            <div key={img.id} className="flex gap-2 rounded-lg border border-line bg-card p-2">
              <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-app">
                {img.signed_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img.signed_url} alt={`Slide ${i + 1}`} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full items-center justify-center text-center text-[10px] leading-tight text-ink-3">
                    No image yet
                  </span>
                )}
                <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[9px] text-white">
                  {i + 1}
                </span>
              </span>
              <textarea
                defaultValue={img.caption ?? ""}
                rows={2}
                placeholder={`Slide ${i + 1} text…`}
                onBlur={(e) => {
                  if (e.target.value === (img.caption ?? "")) return;
                  startTransition(async () => {
                    await updateCarouselCaptionAction(img.id, videoId, e.target.value);
                  });
                }}
                className="min-w-0 flex-1 resize-none rounded-md bg-raised px-2 py-1.5 text-xs placeholder:text-ink-3 focus:outline-none"
              />
              <div className="flex shrink-0 flex-col items-center gap-0.5">
                <button
                  type="button"
                  disabled={i === 0}
                  title="Move earlier"
                  onClick={() =>
                    startTransition(async () => {
                      await moveCarouselImageAction(img.id, videoId, "left");
                      router.refresh();
                    })
                  }
                  className="rotate-180 rounded p-1 text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-30"
                >
                  <IconChevronDown size={12} />
                </button>
                <button
                  type="button"
                  disabled={i === images.length - 1}
                  title="Move later"
                  onClick={() =>
                    startTransition(async () => {
                      await moveCarouselImageAction(img.id, videoId, "right");
                      router.refresh();
                    })
                  }
                  className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-30"
                >
                  <IconChevronDown size={12} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    startTransition(async () => {
                      await deleteCarouselImageAction(img.id, videoId);
                      router.refresh();
                    })
                  }
                  aria-label="Remove"
                  className="rounded p-1 text-ink-3 hover:bg-hover hover:text-danger"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
        }}
        onClick={() => !uploading && inputRef.current?.click()}
        className="cursor-pointer rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-xs text-ink-2 hover:border-accent"
      >
        {images.length > 0 ? "Add more images" : "Drop carousel images here, or click to choose"}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {upload ? <UploadStatus state={upload} /> : null}
    </div>
  );
}
