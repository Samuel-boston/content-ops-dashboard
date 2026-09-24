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
import { sendWithProgress } from "@/lib/upload-progress";
import { UploadStatus, type UploadState } from "@/components/ui/UploadStatus";

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
  const [state, setState] = useState<UploadState | null>(null);
  const uploading = state?.phase === "uploading";
  const [, startTransition] = useTrackedTransition();
  // Raw footage only. Finished-video links are the deliverable and have their
  // own panel; screenshots and clips attached to the brief live with the brief.
  assets = assets.filter((a) => a.kind === "raw");

  async function upload(file: File) {
    const title = "Raw footage";
    if (file.size > MAX_UPLOAD_BYTES) {
      setState({
        phase: "error",
        title,
        detail: `${file.name} is ${Math.round(file.size / 1024 / 1024)} MB — over the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB upload limit. Paste a Drive or Dropbox link below instead.`,
      });
      return;
    }
    const detail = `Uploading ${file.name}`;
    setState({ phase: "uploading", title, pct: 0, detail });
    const res = await createFootageUploadUrlAction(videoId, file.name);
    if (!res?.ok) {
      setState({ phase: "error", title, detail: res?.error ?? "Could not start upload." });
      return;
    }
    try {
      await sendWithProgress(res.signedUrl, file, {
        method: "PUT",
        headers: { "x-upsert": "true" },
        onProgress: (pct) => setState({ phase: "uploading", title, pct, detail }),
      });
      const r = await registerAssetAction({
        videoId,
        label: file.name,
        storagePath: res.path,
        sizeBytes: file.size,
      });
      if ("error" in r && r.error) throw new Error(r.error);
      setState(
        driveConfigured
          ? {
              phase: "processing",
              title,
              detail: `${file.name} is saved. It is being copied to Google Drive in the background.`,
            }
          : { phase: "done", title, detail: `${file.name} is saved.` }
      );
      router.refresh();
    } catch (e) {
      setState({ phase: "error", title, detail: (e as Error).message });
    }
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
              {a.storage_path && !a.drive_url && driveConfigured ? (
                <span className="shrink-0 text-[10px] text-ink-3" title="Uploaded — copying to Google Drive in the background">
                  Copying to Drive…
                </span>
              ) : a.drive_url ? (
                <span className="shrink-0 text-[10px] text-ok" title="Saved in Google Drive">
                  In Drive ✓
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
        onClick={() => !uploading && inputRef.current?.click()}
        className="cursor-pointer rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-xs text-ink-2 hover:border-accent"
      >
        Drop raw footage here, or click to choose
        <input
          ref={inputRef}
          type="file"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
      </div>
      {state ? <UploadStatus state={state} className="mt-2" /> : null}

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
