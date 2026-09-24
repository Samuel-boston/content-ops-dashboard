"use client";

import { sendWithProgress } from "@/lib/upload-progress";
import { UploadStatus, type UploadState } from "@/components/ui/UploadStatus";
import { useRef, useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import {
  addReferenceAction,
  createReferenceUploadUrlAction,
  deleteReferenceAction,
} from "@/app/library-actions";
import type { ReferenceItem } from "@/lib/types";

export function VideoReferences({
  videoId,
  items,
}: {
  videoId: string;
  items: ReferenceItem[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [, startTransition] = useTrackedTransition();
  const [upload, setUpload] = useState<UploadState | null>(null);
  const busy = upload?.phase === "uploading";

  async function uploadImage(file: File) {
    const title = "Reference image";
    setUpload({ phase: "uploading", title, pct: 0, detail: file.name });
    try {
      const res = await createReferenceUploadUrlAction(file.name);
      if (!res?.ok) throw new Error("Could not start the upload.");
      await sendWithProgress(res.signedUrl, file, {
        method: "PUT",
        headers: { "x-upsert": "true" },
        onProgress: (pct) => setUpload({ phase: "uploading", title, pct, detail: file.name }),
      });
      await addReferenceAction({ videoId, kind: "image", storagePath: res.path, note });
      setNote("");
      setUpload({ phase: "done", title, detail: `${file.name} is attached.` });
      router.refresh();
    } catch (e) {
      setUpload({ phase: "error", title, detail: (e as Error).message });
    }
  }

  return (
    <div className="rounded-xl border border-line bg-app p-4">
      <h3 className="mb-2 text-sm font-semibold text-ink-2">Reference / inspiration</h3>
      <p className="mb-3 text-[11px] text-ink-3">
        Attached to this video — auto-archives when it&rsquo;s Posted.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((it) => (
          <div key={it.id} className="group relative overflow-hidden rounded-md border border-line">
            {it.kind === "image" && it.signed_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={it.signed_url} alt="" className="aspect-square w-full object-cover" />
            ) : it.kind === "video" && it.signed_url ? (
              <video
                src={it.signed_url}
                controls
                muted
                className="aspect-square w-full bg-black object-contain"
              />
            ) : (
              <a
                href={it.url ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="flex aspect-square w-full items-center justify-center bg-card p-2 text-center text-[11px] text-accent-hi hover:underline"
              >
                {it.url ? new URL(it.url).hostname : "link"}
              </a>
            )}
            {it.note ? (
              <p className="px-1.5 py-1 text-[10px] text-ink-2">{it.note}</p>
            ) : null}
            <button
              onClick={() => deleteReferenceAction(it.id).then(() => router.refresh())}
              className="absolute right-1 top-1 rounded bg-black/60 px-1 text-xs text-white opacity-0 group-hover:opacity-100"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className="w-full rounded bg-raised px-2 py-1 text-xs outline-none"
        />
        <div className="flex gap-2">
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Paste a link…"
            className="flex-1 rounded bg-raised px-2 py-1 text-xs outline-none"
          />
          <button
            onClick={() =>
              startTransition(async () => {
                if (!link.trim()) return;
                await addReferenceAction({ videoId, kind: "link", url: link.trim(), note });
                setLink("");
                setNote("");
                router.refresh();
              })
            }
            className="rounded bg-hover px-2 py-1 text-xs hover:bg-line-strong"
          >
            Add link
          </button>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="rounded bg-hover px-2 py-1 text-xs hover:bg-line-strong disabled:opacity-50"
          >
            Upload image
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadImage(f);
              e.target.value = "";
            }}
          />
        </div>
        {upload ? <UploadStatus state={upload} /> : null}
      </div>
    </div>
  );
}
