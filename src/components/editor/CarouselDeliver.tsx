"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import {
  createCarouselUploadUrlAction,
  deleteCarouselImageAction,
  registerCarouselImageAction,
} from "@/app/carousel-actions";
import type { CarouselImage } from "@/lib/types";

/**
 * Carousel posts are a sequence of images, not a cut — this skips Cloudflare
 * Stream entirely and uploads straight to Supabase Storage, same as footage.
 * Drop several at once; each just appears as the next slide.
 */
export function CarouselDeliver({ videoId, images }: { videoId: string; images: CarouselImage[] }) {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [, startTransition] = useTrackedTransition();
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);

  async function uploadOne(file: File) {
    const res = await createCarouselUploadUrlAction(videoId, file.name);
    if (!res?.ok) throw new Error(res?.error ?? "Could not start upload.");
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", res.signedUrl);
      xhr.setRequestHeader("x-upsert", "true");
      xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
      xhr.onerror = () => reject(new Error("Upload failed"));
      xhr.send(file);
    });
    const r = await registerCarouselImageAction({ videoId, storagePath: res.path, sizeBytes: file.size });
    if (r?.error) throw new Error(r.error);
  }

  async function uploadFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    setUploading({ done: 0, total: files.length });
    try {
      for (const f of files) {
        await uploadOne(f);
        setUploading((s) => (s ? { done: s.done + 1, total: s.total } : s));
      }
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
    setUploading(null);
  }

  return (
    <div className="space-y-2.5">
      {images.length > 0 ? (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {images.map((img, i) => (
            <div key={img.id} className="group relative aspect-square overflow-hidden rounded-lg bg-card">
              {img.signed_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img.signed_url} alt={`Slide ${i + 1}`} className="h-full w-full object-cover" />
              ) : null}
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">
                {i + 1}
              </span>
              <button
                type="button"
                onClick={() =>
                  startTransition(async () => {
                    await deleteCarouselImageAction(img.id, videoId);
                    router.refresh();
                  })
                }
                className="absolute right-1 top-1 hidden rounded-full bg-black/60 px-1.5 text-xs leading-5 text-white group-hover:block hover:bg-danger"
                aria-label="Remove"
              >
                ×
              </button>
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
        onClick={() => uploading === null && inputRef.current?.click()}
        className="cursor-pointer rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-xs text-ink-2 hover:border-accent"
      >
        {uploading
          ? `Uploading ${uploading.done}/${uploading.total}…`
          : images.length > 0
            ? "Add more images"
            : "Drop carousel images here, or click to choose"}
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
    </div>
  );
}
