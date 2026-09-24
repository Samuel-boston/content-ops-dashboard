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

/**
 * Drag-and-drop a cut. Gets a one-time Cloudflare direct-upload URL from the
 * server, then uploads the file straight to Cloudflare (bytes never touch our
 * server), then polls until the version is processed.
 */
export function UploadDropzone({ cutId, compact }: { cutId: string; compact?: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<
    { phase: "idle" | "uploading" | "original" | "processing" | "done" | "error"; pct?: number; msg?: string }
  >({ phase: "idle" });

  async function handleFile(file: File) {
    setState({ phase: "uploading", pct: 0 });
    const res = await createUploadUrlAction(cutId);
    if (!res?.ok) {
      setState({ phase: "error", msg: res?.error ?? "Could not start upload." });
      return;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", res.uploadURL);
        const form = new FormData();
        form.append("file", file);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setState({ phase: "uploading", pct: Math.round((e.loaded / e.total) * 100) });
        };
        xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.send(form);
      });
    } catch (e) {
      setState({ phase: "error", msg: (e as Error).message });
      return;
    }

    // Stream re-encodes for playback and only offers that re-encode back, so a
    // download from it is smaller and softer than what was uploaded. The
    // untouched file is kept too — this is what gets posted and archived.
    let originalNote: string | null = null;
    if (file.size > MAX_UPLOAD_BYTES) {
      originalNote = `Over the ${MAX_UPLOAD_MB} MB upload limit, so only Cloudflare's re-encoded copy is kept.`;
    } else {
      setState({ phase: "original", pct: 0 });
      try {
        const o = await createOriginalUploadAction(res.versionId, file.name);
        if (!o?.ok) throw new Error(o?.error ?? "Couldn't save the original.");
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", o.signedUrl);
          xhr.setRequestHeader("x-upsert", "true");
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setState({ phase: "original", pct: Math.round((e.loaded / e.total) * 100) });
          };
          xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`status ${xhr.status}`)));
          xhr.onerror = () => reject(new Error("network error"));
          xhr.send(file);
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

    setState({ phase: "processing" });
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const s = await syncVersionAction(res.versionId);
      if (s?.status === "ready") {
        setState({ phase: "done", msg: originalNote ?? undefined });
        router.refresh();
        return;
      }
      if (s?.status === "errored") {
        setState({ phase: "error", msg: "Cloudflare could not process this file." });
        return;
      }
    }
    setState({ phase: "processing", msg: "Still processing — refresh in a minute." });
    router.refresh();
  }

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) handleFile(f);
      }}
      onClick={() => inputRef.current?.click()}
      className={`cursor-pointer rounded-lg border border-dashed border-line-strong text-center text-ink-2 hover:border-accent ${
        compact ? "px-3 py-3 text-xs" : "px-4 py-8 text-sm"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      {state.phase === "idle" && <span><strong className="text-ink">Drop a cut here</strong> or click to upload a new version</span>}
      {state.phase === "uploading" && <span>Uploading… {state.pct ?? 0}%</span>}
      {state.phase === "original" && <span>Saving the original… {state.pct ?? 0}%</span>}
      {state.phase === "processing" && <span>Processing on Cloudflare… {state.msg ?? ""}</span>}
      {state.phase === "done" && (
        <span className="text-ok">
          New version ready ✓
          {state.msg ? <span className="mt-1 block text-warn">{state.msg}</span> : null}
        </span>
      )}
      {state.phase === "error" && <span className="text-danger">{state.msg}</span>}
    </div>
  );
}
