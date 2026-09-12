"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addReferenceAction,
  createReferenceUploadUrlAction,
  deleteReferenceAction,
  setReferenceStatusAction,
} from "@/app/library-actions";
import type { ReferenceItem } from "@/lib/types";

export function ReferenceHolding({ items }: { items: ReferenceItem[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<"open" | "archived">("open");

  const open = items.filter((i) => i.status === "open" || i.status === "used" || i.status === "dismissed");
  const archived = items.filter((i) => i.status === "archived");
  const shown = tab === "open" ? open : archived;

  async function uploadImage(file: File) {
    const res = await createReferenceUploadUrlAction(file.name);
    if (res?.ok) {
      await fetch(res.signedUrl, { method: "PUT", body: file, headers: { "x-upsert": "true" } });
      await addReferenceAction({ kind: "image", storagePath: res.path, note });
      setNote("");
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-app p-4">
        <p className="mb-2 text-sm text-ink-2">
          Unattached inspiration. Mark it <strong>used</strong> or <strong>dismiss</strong> it —
          anything untouched auto-archives after ~30 days so this never piles up.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="w-48 rounded bg-raised px-2 py-1.5 text-sm outline-none"
          />
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Paste a link…"
            className="flex-1 rounded bg-raised px-2 py-1.5 text-sm outline-none"
          />
          <button
            onClick={async () => {
              if (!link.trim()) return;
              await addReferenceAction({ kind: "link", url: link.trim(), note });
              setLink("");
              setNote("");
              router.refresh();
            }}
            className="rounded bg-hover px-3 py-1.5 text-sm hover:bg-line-strong"
          >
            Add link
          </button>
          <button
            onClick={() => inputRef.current?.click()}
            className="rounded bg-hover px-3 py-1.5 text-sm hover:bg-line-strong"
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
            }}
          />
        </div>
      </div>

      <div className="flex gap-1">
        {(["open", "archived"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1 text-sm capitalize ${
              tab === t ? "bg-raised text-ink" : "text-ink-2 hover:text-ink"
            }`}
          >
            {t} ({t === "open" ? open.length : archived.length})
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-line bg-card px-4 py-8 text-center text-sm text-ink-3">
          Nothing here.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((it) => (
            <div key={it.id} className="overflow-hidden rounded-lg border border-line bg-app">
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
                  className="flex aspect-square w-full items-center justify-center bg-card p-3 text-center text-xs text-accent-hi hover:underline"
                >
                  {it.url ? new URL(it.url).hostname : "link"}
                </a>
              )}
              <div className="p-2">
                {it.note ? <p className="mb-1 text-xs text-ink-2">{it.note}</p> : null}
                <p className="mb-1.5 text-[10px] text-ink-3">
                  {it.status !== "open" ? `${it.status} · ` : ""}
                  {new Date(it.created_at).toLocaleDateString()}
                </p>
                {tab === "open" ? (
                  <div className="flex gap-2 text-[11px]">
                    <button
                      onClick={() => setReferenceStatusAction(it.id, "used").then(() => router.refresh())}
                      className="text-ok hover:underline"
                    >
                      Used
                    </button>
                    <button
                      onClick={() =>
                        setReferenceStatusAction(it.id, "dismissed").then(() => router.refresh())
                      }
                      className="text-ink-2 hover:underline"
                    >
                      Dismiss
                    </button>
                    <button
                      onClick={() => deleteReferenceAction(it.id).then(() => router.refresh())}
                      className="ml-auto text-ink-3 hover:text-danger"
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
