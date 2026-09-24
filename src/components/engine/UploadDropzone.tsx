"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createOriginalUploadAction,
  createUploadUrlAction,
  registerCutOriginalAction,
  syncVersionAction,
} from "@/app/engine-actions";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/limits";
import { sendWithProgress } from "@/lib/upload-progress";
import { UploadStatus, type UploadState } from "@/components/ui/UploadStatus";

/**
 * Drag-and-drop a cut. Gets a one-time Cloudflare direct-upload URL from the
 * server, then uploads the file straight to Cloudflare (bytes never touch our
 * server), then polls until the version is processed.
 */
export function UploadDropzone({ cutId, compact }: { cutId: string; compact?: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState | null>(null);
  const busy = state?.phase === "uploading" || state?.phase === "processing";

  async function handleFile(file: File) {
    const keepOriginal = file.size <= MAX_UPLOAD_BYTES;
    const steps = keepOriginal ? 3 : 2;
    const title = "Finished video";
    setState({ phase: "uploading", title, pct: 0, step: `Step 1 of ${steps}`, detail: `Uploading ${file.name}` });
    const res = await createUploadUrlAction(cutId);
    if (!res?.ok) {
      setState({ phase: "error", title, detail: res?.error ?? "Could not start upload." });
      return;
    }
    try {
      const form = new FormData();
      form.append("file", file);
      await sendWithProgress(res.uploadURL, form, {
        method: "POST",
        onProgress: (pct) =>
          setState({ phase: "uploading", title, pct, step: `Step 1 of ${steps}`, detail: `Uploading ${file.name}` }),
      });
    } catch (e) {
      setState({ phase: "error", title, detail: (e as Error).message });
      return;
    }

    // Stream re-encodes for playback and only offers that re-encode back, so a
    // download from it is smaller and softer than what was uploaded. The
    // untouched file is kept too — this is what gets posted and archived.
    let originalNote: string | null = null;
    if (!keepOriginal) {
      originalNote = `Over the ${MAX_UPLOAD_MB} MB upload limit, so only Cloudflare's re-encoded copy is kept.`;
    } else {
      const step = `Step 2 of ${steps}`;
      const detail = `Saving the untouched original of ${file.name}`;
      setState({ phase: "uploading", title, pct: 0, step, detail });
      try {
        const o = await createOriginalUploadAction(res.versionId, file.name);
        if (!o?.ok) throw new Error(o?.error ?? "Couldn't save the original.");
        await sendWithProgress(o.signedUrl, file, {
          method: "PUT",
          headers: { "x-upsert": "true" },
          onProgress: (pct) => setState({ phase: "uploading", title, pct, step, detail }),
        });
        const reg = await registerCutOriginalAction({
          versionId: res.versionId,
          path: o.path,
          name: file.name,
          bytes: file.size,
        });
        if (!reg?.ok) throw new Error(reg?.error ?? "Couldn't record the original.");
      } catch (e) {
        originalNote = `The original couldn't be saved (${(e as Error).message}) — only Cloudflare's re-encoded copy exists.`;
      }
    }

    // Everything has left this browser. Cloudflare finishes on its own from
    // here (and the server re-checks it if this page is closed), so the page
    // only polls to show the result the moment it lands.
    const processing: UploadState = {
      phase: "processing",
      title,
      step: `Step ${steps} of ${steps}`,
      detail: "Cloudflare is preparing the video for playback — usually one to three minutes.",
      note: originalNote ?? undefined,
    };
    setState(processing);
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const s = await syncVersionAction(res.versionId);
      if (s?.status === "ready") {
        setState({ phase: "done", title, detail: `${file.name} is ready to review.`, note: originalNote ?? undefined });
        router.refresh();
        return;
      }
      if (s?.status === "errored") {
        setState({ phase: "error", title, detail: "Cloudflare could not process this file." });
        return;
      }
    }
    setState({
      ...processing,
      detail: "Still processing — a long video can take a few minutes. It will appear here when ready; you can close this page.",
    });
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f && !busy) handleFile(f);
        }}
        onClick={() => !busy && inputRef.current?.click()}
        className={`rounded-lg border border-dashed border-line-strong text-center text-ink-2 ${
          busy ? "cursor-default opacity-60" : "cursor-pointer hover:border-accent"
        } ${compact ? "px-3 py-3 text-xs" : "px-4 py-8 text-sm"}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
        <span>
          <strong className="text-ink">Drop a cut here</strong> or click to upload a new version
        </span>
      </div>
      {state ? <UploadStatus state={state} /> : null}
    </div>
  );
}
