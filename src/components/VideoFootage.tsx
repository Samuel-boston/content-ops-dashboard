"use client";

import { useRef, useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import {
  createFootageUploadUrlAction,
  deleteAssetAction,
  registerAssetAction,
} from "@/app/asset-actions";
import { useToast } from "@/components/ui/Toast";
import type { VideoAsset } from "@/lib/types";

import { MAX_UPLOAD_BYTES } from "@/lib/limits"; // see lib/limits.ts — the plan's per-file cap

const size = (b: number | null) => {
  if (!b) return "";
  const mb = b / 1024 / 1024;
  return mb > 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
};

/**
 * Raw footage / source files. These skip Cloudflare Stream entirely — they
 * never need scrubbing or comments — and land in Drive (or private Storage
 * until Drive is connected).
 */
export function VideoFootage({
  videoId,
  assets,
  driveConfigured,
}: {
  videoId: string;
  assets: VideoAsset[];
  driveConfigured: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [, startTransition] = useTrackedTransition();
  // Raw footage only. Finished-video links are the deliverable and have their
  // own panel; screenshots and clips attached to the brief live with the brief.
  assets = assets.filter((a) => a.kind === "raw");

  async function upload(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(
        `${file.name} is ${Math.round(file.size / 1024 / 1024)} MB — over the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB upload limit. Paste a Drive or Dropbox link below instead.`
      );
      return;
    }
    setProgress(0);
    const res = await createFootageUploadUrlAction(videoId, file.name);
    if (!res?.ok) {
      toast.error(res?.error ?? "Could not start upload.");
      setProgress(null);
      return;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", res.signedUrl);
        xhr.setRequestHeader("x-upsert", "true");
        xhr.upload.onprogress = (e) =>
          e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
        xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(xhr.status === 413 ? "That file is too large to upload — paste a link instead." : `Upload failed (${xhr.status})`)));
        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.send(file);
      });
      const r = await registerAssetAction({
        videoId,
        label: file.name,
        storagePath: res.path,
        sizeBytes: file.size,
      });
      if (toast.result(r, driveConfigured ? "Uploaded — mirroring to Drive" : "Footage uploaded")) {
        router.refresh();
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
    setProgress(null);
  }

  return (
    <div className="rounded-xl border border-line bg-app p-4">
      <h3 className="text-sm font-semibold text-ink-2">Raw footage</h3>
      <p className="mb-3 mt-0.5 text-[11px] text-ink-3">
        Source files for this video.{" "}
        {driveConfigured
          ? "Uploads mirror to Google Drive automatically."
          : "Stored privately until Google Drive is connected, then mirrored across."}
      </p>

      {assets.length > 0 ? (
        <ul className="mb-3 space-y-1.5">
          {assets.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded-md border border-line bg-card px-2 py-1.5 text-sm"
            >
              <span className="flex-1 truncate">{a.label}</span>
              {a.size_bytes ? (
                <span className="shrink-0 font-mono text-[11px] text-ink-3">
                  {size(a.size_bytes)}
                </span>
              ) : null}
              {/* One way to get a file, whoever you are: through the dashboard, which
                  holds the Drive login — editors have no access to the Drive itself. */}
              {a.drive_url || a.signed_url || a.storage_path ? (
                <a
                  href={`/api/footage/${a.id}`}
                  className="shrink-0 text-xs text-accent-hi hover:underline"
                >
                  Download
                </a>
              ) : a.external_url ? (
                <a
                  href={a.external_url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-xs text-accent-hi hover:underline"
                >
                  Open
                </a>
              ) : null}
              <button
                onClick={() =>
                  startTransition(async () => {
                    await deleteAssetAction(a.id, videoId);
                    router.refresh();
                  })
                }
                className="shrink-0 text-ink-3 hover:text-danger"
                aria-label="Remove"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) upload(f);
        }}
        onClick={() => progress === null && inputRef.current?.click()}
        className="cursor-pointer rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-xs text-ink-2 hover:border-accent"
      >
        {progress !== null ? `Uploading… ${progress}%` : "Drop raw footage here, or click to choose"}
        <input
          ref={inputRef}
          type="file"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
        />
      </div>

      <div className="mt-2 flex gap-2">
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="…or paste a Drive / Dropbox link"
          className="flex-1 rounded bg-raised px-2 py-1 text-xs outline-none"
        />
        <button
          onClick={() =>
            startTransition(async () => {
              if (!link.trim()) return;
              const r = await registerAssetAction({
                videoId,
                label: link.trim().split("/").pop() || "Linked footage",
                externalUrl: link.trim(),
              });
              if (toast.result(r, "Link added")) {
                setLink("");
                router.refresh();
              }
            })
          }
          className="rounded bg-hover px-2 py-1 text-xs hover:bg-line-strong"
        >
          Add
        </button>
      </div>
    </div>
  );
}
