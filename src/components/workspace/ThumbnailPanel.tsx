"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { IconSparkles, IconTrash, IconX } from "@/components/ui/icons";
import {
  addLibraryRefsAction,
  clearThumbnailAction,
  generateThumbnailAction,
  getThumbnailAction,
  removeThumbnailRefAction,
  saveThumbnailPromptAction,
  uploadFinalThumbnailAction,
  uploadThumbnailRefAction,
  type ThumbnailState,
} from "@/app/thumbnail-actions";
import { libraryFacets, searchLibraryShots } from "@/app/library-visuals-actions";
import type { LibraryShot } from "@/lib/types";

/**
 * The thumbnail, wherever you are in the pipeline: what it looks like now, the
 * images it's built from, and a brief for ChatGPT. Images come from the
 * B-Roll library (the Footage index, searchable by keyword and category) or
 * from your own files. Or skip the design and upload a finished one.
 */
export function ThumbnailPanel({ videoId, defaultOpen = false }: { videoId: string; defaultOpen?: boolean }) {
  const toast = useToast();
  const [state, setState] = useState<ThumbnailState | null | undefined>(undefined);
  const [pending, startTransition] = useTrackedTransition();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(defaultOpen);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalInput = useRef<HTMLInputElement>(null);
  const refInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const s = await getThumbnailAction(videoId);
    setState(s);
    if (s) setPrompt((p) => p || s.prompt);
  }, [videoId]);

  useEffect(() => {
    let alive = true;
    void getThumbnailAction(videoId).then((s) => {
      if (!alive) return;
      setState(s);
      if (s) setPrompt((p) => p || s.prompt);
    });
    return () => {
      alive = false;
    };
  }, [videoId]);

  if (state === undefined) return <div className="rounded-xl border border-line bg-card p-3 text-xs text-ink-3">Loading thumbnail…</div>;
  if (state === null) return null;
  const s = state;

  function changePrompt(v: string) {
    setPrompt(v);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveThumbnailPromptAction(videoId, v), 700);
  }

  function run(fn: () => Promise<{ error?: string } | { ok: true } | { ok: true; added: number }>, done?: string) {
    startTransition(async () => {
      const res = await fn();
      if ("error" in res && res.error) return toast.error(res.error);
      if (done) toast.success(done);
      await load();
    });
  }

  function submitFile(kind: "final" | "refs", files: FileList | null) {
    if (!files?.length) return;
    const fd = new FormData();
    if (kind === "final") fd.append("file", files[0]);
    else Array.from(files).forEach((f) => fd.append("file", f));
    run(() => (kind === "final" ? uploadFinalThumbnailAction(videoId, fd) : uploadThumbnailRefAction(videoId, fd)), kind === "final" ? "Thumbnail saved." : "Added.");
  }

  return (
    <section className="rounded-xl border border-line bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <span className="h-10 w-[4.5rem] shrink-0 overflow-hidden rounded-md border border-line bg-raised">
          {s.url ? (
            // Signed Supabase Storage URL, short-lived — next/image would fight the expiry.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.url} alt="" className="h-full w-full object-cover" />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Thumbnail</span>
          <span className="block truncate text-[11px] text-ink-3">
            {s.url ? "Set" : "Not set yet"}
            {s.refs.length ? ` · ${s.refs.length} image${s.refs.length === 1 ? "" : "s"} attached` : ""}
          </span>
        </span>
        <span className="text-[11px] text-ink-3">{open ? "Hide" : "Open"}</span>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-line p-3">
          <div className="overflow-hidden rounded-lg border border-line bg-raised">
            {s.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.url} alt={`Thumbnail for ${s.title}`} className="mx-auto max-h-64 w-auto object-contain" />
            ) : (
              <div className="flex h-28 items-center justify-center px-4 text-center text-xs text-ink-3">
                No thumbnail yet. Attach images and a brief and let ChatGPT design one, or upload your own.
              </div>
            )}
          </div>

          {s.canEdit ? (
            <>
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Images</h3>
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="ml-auto rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-2 hover:border-accent hover:text-ink"
                  >
                    Add images
                  </button>
                </div>
                {s.refs.length ? (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {s.refs.map((r) => (
                      <div key={r.id} className="group relative aspect-video overflow-hidden rounded-lg border border-line bg-raised">
                        {r.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.url} alt={r.label ?? ""} className="h-full w-full object-cover" />
                        ) : null}
                        <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px] uppercase text-white">
                          {r.source === "library" ? "Library" : "Yours"}
                        </span>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => run(() => removeThumbnailRefAction(videoId, r.id))}
                          title="Remove"
                          className="absolute right-1 top-1 rounded bg-black/60 p-0.5 text-white opacity-0 transition group-hover:opacity-100"
                        >
                          <IconX size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-ink-3">
                    Nothing attached. Add images from the B-Roll library, or upload your own.
                  </p>
                )}
              </div>

              <div>
                <label htmlFor={`thumb-brief-${videoId}`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                  Brief for the design
                </label>
                <textarea
                  id={`thumb-brief-${videoId}`}
                  value={prompt}
                  onChange={(e) => changePrompt(e.target.value)}
                  rows={3}
                  placeholder="What should it show or say? Who is in it, what mood, any words on the image…"
                  className="w-full resize-none rounded-lg border border-line bg-raised px-2.5 py-2 text-xs leading-relaxed placeholder:text-ink-3 focus:border-accent focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={orientation}
                  onChange={(e) => setOrientation(e.target.value as "landscape" | "portrait")}
                  aria-label="Shape"
                  className="rounded-lg border border-line bg-raised px-2 py-1.5 text-xs"
                >
                  <option value="landscape">Landscape 16:9</option>
                  <option value="portrait">Vertical 9:16</option>
                </select>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Change for this attempt (optional)"
                  className="min-w-[10rem] flex-1 rounded-lg border border-line bg-raised px-2.5 py-1.5 text-xs placeholder:text-ink-3 focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  disabled={pending || !s.canGenerate}
                  onClick={() => {
                    if (saveTimer.current) clearTimeout(saveTimer.current);
                    startTransition(async () => {
                      await saveThumbnailPromptAction(videoId, prompt);
                      const res = await generateThumbnailAction(videoId, { orientation, note });
                      if ("error" in res && res.error) return toast.error(res.error);
                      toast.success("Thumbnail designed.");
                      setNote("");
                      await load();
                    });
                  }}
                  title={s.canGenerate ? undefined : "Add an OpenAI API key in Settings → Integrations first"}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hi disabled:opacity-50"
                >
                  <IconSparkles size={12} />
                  {pending ? "Working…" : s.url ? "Redesign with ChatGPT" : "Design with ChatGPT"}
                </button>
              </div>
              {!s.canGenerate ? (
                <p className="text-[11px] text-ink-3">
                  ChatGPT design needs an OpenAI key (Settings → Integrations). You can still attach images and upload a finished thumbnail.
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <input
                  ref={finalInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(e) => {
                    submitFile("final", e.target.files);
                    e.target.value = "";
                  }}
                />
                <input
                  ref={refInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  hidden
                  onChange={(e) => {
                    submitFile("refs", e.target.files);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => finalInput.current?.click()}
                  className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
                >
                  Upload a finished thumbnail
                </button>
                {s.url ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => clearThumbnailAction(videoId), "Removed.")}
                    className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-3 hover:border-danger hover:text-danger disabled:opacity-50"
                  >
                    <IconTrash size={11} />
                    Remove
                  </button>
                ) : null}
                <span className="text-[10px] text-ink-3">JPEG, PNG or WebP, up to 4 MB.</span>
              </div>

              {pickerOpen ? (
                <ImagePicker
                  videoId={videoId}
                  onClose={() => setPickerOpen(false)}
                  onAdded={async () => {
                    setPickerOpen(false);
                    await load();
                  }}
                  onUpload={() => refInput.current?.click()}
                />
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Search the B-Roll library by keyword and category and tick the images to attach. */
function ImagePicker({
  videoId,
  onClose,
  onAdded,
  onUpload,
}: {
  videoId: string;
  onClose: () => void;
  onAdded: () => void;
  onUpload: () => void;
}) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [media, setMedia] = useState<"" | "image" | "video">("");
  const [categories, setCategories] = useState<string[]>([]);
  const [shots, setShots] = useState<LibraryShot[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTrackedTransition();

  useEffect(() => {
    void libraryFacets().then((f) => setCategories(f.categories));
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      setShots(await searchLibraryShots({ q, category, media, limit: 36 }));
    }, 250);
    return () => clearTimeout(t);
  }, [q, category, media]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 8) next.add(id);
      return next;
    });

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Add images"
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[85dvh] w-full max-w-3xl flex-col rounded-2xl border border-line bg-card shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="text-base font-semibold">Add images</h2>
          <span className="text-xs text-ink-3">from the B-Roll library</span>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto rounded p-1 text-ink-3 hover:bg-hover hover:text-ink">
            <IconX size={14} />
          </button>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-line px-4 py-3">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by keyword — beach, laughing, city at night…"
            className="min-w-[12rem] flex-1 rounded-lg border border-line bg-raised px-2.5 py-1.5 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" className="rounded-lg border border-line bg-raised px-2 py-1.5 text-sm">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select value={media} onChange={(e) => setMedia(e.target.value as "" | "image" | "video")} aria-label="Type" className="rounded-lg border border-line bg-raised px-2 py-1.5 text-sm">
            <option value="">Photos and clips</option>
            <option value="image">Photos only</option>
            <option value="video">Clips only</option>
          </select>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {shots === null ? (
            <p className="py-8 text-center text-xs text-ink-3">Searching…</p>
          ) : shots.length === 0 ? (
            <p className="py-8 text-center text-xs text-ink-3">
              Nothing matches. Try fewer words, or clear the filters. If the library is empty, connect the B-Roll Librarian first.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
              {shots.map((sh) => {
                const on = picked.has(sh.id);
                return (
                  <button
                    key={sh.id}
                    type="button"
                    onClick={() => toggle(sh.id)}
                    aria-pressed={on}
                    className={`overflow-hidden rounded-lg border text-left transition ${on ? "border-accent ring-2 ring-accent/40" : "border-line hover:border-line-strong"}`}
                  >
                    <div className="relative aspect-video bg-raised">
                      {sh.thumb_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={sh.thumb_url} alt={sh.caption ?? ""} className="h-full w-full object-cover" />
                      ) : null}
                      {on ? <span className="absolute right-1 top-1 rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white">✓</span> : null}
                    </div>
                    <p className="line-clamp-2 px-1.5 py-1 text-[10px] leading-snug text-ink-2">{sh.caption ?? sh.filename}</p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={() => {
              onClose();
              onUpload();
            }}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink"
          >
            Upload my own instead
          </button>
          <span className="ml-auto text-xs text-ink-3">{picked.size} selected (up to 8)</span>
          <button
            type="button"
            disabled={pending || picked.size === 0}
            onClick={() =>
              startTransition(async () => {
                const res = await addLibraryRefsAction(videoId, [...picked]);
                if ("error" in res && res.error) return toast.error(res.error);
                toast.success("Added.");
                onAdded();
              })
            }
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-hi disabled:opacity-50"
          >
            {pending ? "Adding…" : "Add to thumbnail"}
          </button>
        </div>
      </div>
    </div>
  );
}
