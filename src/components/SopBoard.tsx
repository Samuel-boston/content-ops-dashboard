"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSopAction, deleteSopAction, updateSopAction } from "@/app/library-actions";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Markdown } from "@/components/ui/Markdown";
import { FORMATS } from "@/lib/taxonomy";
import type { SopDoc } from "@/lib/types";

export function SopBoard({ docs, canEdit }: { docs: SopDoc[]; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [selectedId, setSelectedId] = useState<string | null>(docs[0]?.id ?? null);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [body, setBody] = useState("");
  const doc = docs.find((d) => d.id === selectedId) ?? docs[0];

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      {dialog}
      <aside className="space-y-1">
        {docs.map((d) => (
          <button
            key={d.id}
            onClick={() => setSelectedId(d.id)}
            className={`block w-full rounded-md px-3 py-2 text-left text-sm ${
              d.id === doc?.id
                ? "bg-raised text-ink"
                : "text-ink-2 hover:bg-hover"
            }`}
          >
            {d.title}
            {d.format ? <span className="block text-[11px] text-ink-3">{d.format}</span> : null}
          </button>
        ))}
        {canEdit ? (
          <form
            action={async (fd) => {
              await createSopAction(fd);
              router.refresh();
            }}
            className="mt-2 space-y-1 rounded-md border border-line p-2"
          >
            <input
              name="title"
              required
              placeholder="New doc title"
              className="w-full rounded bg-raised px-2 py-1 text-sm outline-none"
            />
            <select
              name="format"
              className="w-full rounded bg-raised px-2 py-1 text-xs outline-none"
            >
              <option value="">General</option>
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <button className="w-full rounded bg-hover px-2 py-1 text-xs hover:bg-line-strong">
              Add doc
            </button>
          </form>
        ) : null}
      </aside>

      <div className="rounded-xl border border-line bg-app p-5">
        {!doc ? (
          <p className="text-sm text-ink-3">
            No playbook docs yet.{canEdit ? " Add one on the left." : ""}
          </p>
        ) : canEdit ? (
          <>
            <input
              defaultValue={doc.title}
              onBlur={(e) =>
                updateSopAction(doc.id, { title: e.target.value.trim() || doc.title }).then(() =>
                  router.refresh()
                )
              }
              className="mb-2 w-full bg-transparent text-lg font-semibold outline-none focus:bg-raised rounded px-1"
            />
            <select
              defaultValue={doc.format ?? ""}
              onChange={(e) =>
                updateSopAction(doc.id, { format: e.target.value || null }).then(() => router.refresh())
              }
              className="mb-3 rounded bg-raised px-2 py-1 text-xs outline-none"
            >
              <option value="">General</option>
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <div className="mb-1.5 flex gap-1 text-xs">
              {(["write", "preview"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded px-2 py-1 capitalize ${
                    mode === m ? "bg-raised text-ink" : "text-ink-3 hover:text-ink-2"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            {mode === "write" ? (
              <textarea
                key={doc.id}
                defaultValue={doc.body}
                onChange={(e) => setBody(e.target.value)}
                onBlur={(e) => updateSopAction(doc.id, { body: e.target.value })}
                rows={20}
                placeholder="Good examples, a checklist, the house style… Markdown supported: # heading, **bold**, - list, [link](url)"
                className="w-full resize-y rounded-lg bg-card border border-line p-3 text-sm outline-none focus:border-accent"
              />
            ) : (
              <div className="min-h-[300px] rounded-lg border border-line bg-card p-3">
                <Markdown source={body || doc.body} />
              </div>
            )}
            <button
              onClick={async () => {
                if (await confirm({ title: `Delete “${doc.title}”?`, danger: true })) {
                  const r = await deleteSopAction(doc.id);
                  if (toast.result(r, "Doc deleted")) {
                    setSelectedId(null);
                    router.refresh();
                  }
                }
              }}
              className="mt-2 text-xs text-danger hover:text-red-300"
            >
              Delete doc
            </button>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold">{doc.title}</h2>
            {doc.format ? <p className="text-xs text-ink-3">{doc.format}</p> : null}
            <div className="mt-3">
              {doc.body.trim() ? (
                <Markdown source={doc.body} />
              ) : (
                <p className="text-sm text-ink-3">This doc is empty.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
