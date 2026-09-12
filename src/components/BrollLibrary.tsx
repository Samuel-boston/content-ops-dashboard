"use client";

import { useMemo, useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import {
  IconChevronRight,
  IconFolder,
  IconLink,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX,
} from "@/components/ui/icons";
import {
  addBrollCategoryAction,
  deleteBrollCategoryAction,
  updateBrollCategoryAction,
} from "@/app/editor-actions";
import type { BrollCategory } from "@/lib/types";

/**
 * The index of the client's Drive b-roll.
 *
 * The footage stays on Drive — fifty categories of raw video would cost more
 * to host here than the rest of the product combined, and the client already
 * has it organised. What this solves is the finding: an editor who needs a
 * shot of someone in a sauna shouldn't have to ask, or scroll a Drive with
 * fifty sibling folders in it.
 *
 * A category without a share link is shown as unlinked rather than hidden —
 * the gap is the useful part, otherwise the library looks complete when half
 * of it goes nowhere.
 */
export function BrollLibrary({
  categories,
  canEdit,
}: {
  categories: BrollCategory[];
  canEdit: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();

  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, query]);

  const linked = categories.filter((c) => c.drive_url).length;

  function add() {
    if (!newName.trim()) return;
    startTransition(async () => {
      const res = await addBrollCategoryAction({ name: newName, driveUrl: newUrl });
      if (res?.error) toast.error(res.error);
      else {
        setNewName("");
        setNewUrl("");
        setAdding(false);
        toast.success("Category added.");
        router.refresh();
      }
    });
  }

  function saveUrl(id: string) {
    startTransition(async () => {
      const res = await updateBrollCategoryAction(id, { driveUrl: editUrl });
      if (res?.error) toast.error(res.error);
      else {
        setEditingId(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-48 flex-1">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3">
            <IconSearch size={14} />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search categories…"
            className="w-full rounded-lg border border-line bg-raised py-2 pl-8 pr-3 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
        </label>
        <span className="text-[11px] text-ink-3">
          {linked} of {categories.length} linked
        </span>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs text-ink-2 transition hover:border-accent hover:text-ink"
          >
            <IconPlus size={13} />
            New category
          </button>
        ) : null}
      </div>

      {adding && canEdit ? (
        <div className="space-y-2 rounded-xl border border-accent bg-card p-3">
          <div className="flex flex-wrap gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="Category name"
              className="min-w-40 flex-1 rounded-lg border border-line bg-raised px-3 py-2 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
            <input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="Drive share link (optional)"
              className="min-w-40 flex-[2] rounded-lg border border-line bg-raised px-3 py-2 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              disabled={pending || !newName.trim()}
              onClick={add}
              className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hi disabled:opacity-40"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-lg border border-line px-3 py-2 text-xs text-ink-3 hover:text-ink"
            >
              Cancel
            </button>
          </div>
          <p className="text-[11px] leading-snug text-ink-3">
            This adds the category here. Creating the matching folder in Drive still has to be done
            by hand — once the Drive account is connected, it&rsquo;ll happen automatically.
          </p>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-10 text-center text-sm text-ink-3">
          {query ? `Nothing matching “${query}”.` : "No categories yet."}
        </p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => {
            const editing = editingId === c.id;
            const body = (
              <>
                <span
                  className={`shrink-0 ${c.drive_url ? "text-accent-hi" : "text-ink-3"}`}
                >
                  <IconFolder size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{c.name}</span>
                  {!c.drive_url ? (
                    <span className="block text-[10px] text-ink-3">no link yet</span>
                  ) : null}
                </span>
              </>
            );

            return (
              <div
                key={c.id}
                className="group flex items-center gap-2.5 rounded-xl border border-line bg-card px-3 py-2.5 transition hover:border-line-strong"
              >
                {editing ? (
                  <>
                    <input
                      autoFocus
                      value={editUrl}
                      onChange={(e) => setEditUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveUrl(c.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      placeholder="Paste the Drive share link"
                      className="min-w-0 flex-1 rounded-md border border-line bg-raised px-2 py-1.5 text-xs placeholder:text-ink-3 focus:border-accent focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => saveUrl(c.id)}
                      disabled={pending}
                      className="shrink-0 rounded-md bg-accent px-2 py-1.5 text-[11px] font-medium text-white hover:bg-accent-hi"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      aria-label="Cancel"
                      className="shrink-0 rounded p-1 text-ink-3 hover:text-ink"
                    >
                      <IconX size={12} />
                    </button>
                  </>
                ) : c.drive_url ? (
                  <>
                    <a
                      href={c.drive_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="flex min-w-0 flex-1 items-center gap-2.5"
                    >
                      {body}
                      <IconChevronRight
                        size={12}
                        className="shrink-0 text-ink-3 transition group-hover:translate-x-0.5"
                      />
                    </a>
                    {canEdit ? <RowActions
                      onEdit={() => {
                        setEditingId(c.id);
                        setEditUrl(c.drive_url ?? "");
                      }}
                      onDelete={() =>
                        startTransition(async () => {
                          const res = await deleteBrollCategoryAction(c.id);
                          if (res?.error) toast.error(res.error);
                          else router.refresh();
                        })
                      }
                    /> : null}
                  </>
                ) : (
                  <>
                    <span className="flex min-w-0 flex-1 items-center gap-2.5">{body}</span>
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(c.id);
                          setEditUrl("");
                        }}
                        className="flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-1 text-[10px] text-ink-3 hover:border-accent hover:text-ink"
                      >
                        <IconLink size={10} />
                        Link
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <span className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onDelete}
          className="rounded px-1.5 py-1 text-[10px] text-danger hover:bg-danger/10"
        >
          Remove
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded px-1.5 py-1 text-[10px] text-ink-3 hover:text-ink"
        >
          Keep
        </button>
      </span>
    );
  }

  return (
    <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
      <button
        type="button"
        onClick={onEdit}
        aria-label="Change the link"
        className="rounded p-1 text-ink-3 hover:text-ink"
      >
        <IconLink size={11} />
      </button>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label="Remove category"
        className="rounded p-1 text-ink-3 hover:text-danger"
      >
        <IconTrash size={11} />
      </button>
    </span>
  );
}
