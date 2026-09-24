"use client";

import { useRef, useState } from "react";
import { IconCamera, IconCheck } from "@/components/ui/icons";
import { fileSize } from "@/lib/format";

interface Done {
  name: string;
  size: number;
}

/**
 * Film on your phone, send it straight in. Opened by scanning the code on the
 * video page, so the phone never has to be signed in.
 *
 * Bytes go straight to storage from the phone — they never route through our
 * server, which is what makes a multi-gigabyte clip feasible over mobile data.
 */
export function GuestUpload({ token, videoTitle }: { token: string; videoTitle: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ name: string; percent: number } | null>(null);
  const [done, setDone] = useState<Done[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setBusy(true);
    try {
      for (const file of files) {
        const res = await fetch("/api/guest-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, filename: file.name, size: file.size }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Couldn't start the upload.");

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", json.signedUrl);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              setProgress({ name: file.name, percent: (e.loaded / e.total) * 100 });
            }
          };
          xhr.onload = () =>
            xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`));
          xhr.onerror = () => reject(new Error("Network dropped during upload."));
          xhr.send(file);
        });

        await fetch("/api/guest-upload", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, path: json.path, filename: file.name, size: file.size }),
        });

        setDone((d) => [...d, { name: file.name, size: file.size }]);
      }
      setProgress(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">
        Send footage for <span className="text-ink">{videoTitle}</span>. It goes straight to the
        editors.
      </p>

      <input
        ref={input}
        type="file"
        accept="video/*"
        multiple
        hidden
        onChange={(e) => {
          void upload(e.target.files);
          e.target.value = "";
        }}
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-line-strong py-12 text-ink-2 transition hover:border-accent hover:text-ink disabled:opacity-50"
      >
        <IconCamera size={26} />
        <span className="text-sm font-medium">
          {busy ? "Uploading…" : "Choose or record a video"}
        </span>
        <span className="text-[11px] text-ink-3">Straight from your camera roll</span>
      </button>

      {progress ? (
        <div className="rounded-xl border border-line bg-card p-3">
          <p className="truncate text-xs text-ink-2">{progress.name}</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <p className="mt-1 text-right text-[11px] tabular-nums text-ink-3">
            {Math.round(progress.percent)}%
          </p>
          <p className="mt-1 text-[11px] font-medium text-warn">
            Keep this page open until it reaches 100%.
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {done.length ? (
        <div className="space-y-1.5">
          {done.map((d, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-xl border border-ok/30 bg-ok/5 px-3 py-2 text-xs"
            >
              <IconCheck size={13} className="text-ok" />
              <span className="min-w-0 flex-1 truncate">{d.name}</span>
              <span className="text-ink-3">{fileSize(d.size)}</span>
            </div>
          ))}
          <p className={`pt-1 text-center text-[11px] ${busy ? "font-medium text-warn" : "text-ok"}`}>
            {busy ? "Keep this page open until the last file finishes." : "Sent. You can close this page."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
