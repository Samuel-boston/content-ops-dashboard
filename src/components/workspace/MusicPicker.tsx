"use client";

import { useMemo, useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { attachTrackAction, detachTrackAction } from "@/app/library-actions";
import { IconPlus, IconSearch, IconX } from "@/components/ui/icons";
import { timecode } from "@/lib/format";
import type { MusicTrack } from "@/lib/types";

/**
 * Which track this video is cut to.
 *
 * The decision is usually the client's taste and the editor's execution, so
 * either can attach one — and both see the same answer, which is the point.
 * Tracks play inline from a signed URL rather than downloading: choosing music
 * means hearing it, and a download step is enough friction to stop people
 * bothering.
 */
export function MusicPicker({
  videoId,
  attached,
  library,
  canEdit,
}: {
  videoId: string;
  attached: MusicTrack[];
  /** The whole library, already signed for playback. */
  library: MusicTrack[];
  canEdit: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");

  const attachedIds = useMemo(() => new Set(attached.map((t) => t.id)), [attached]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return library
      .filter((t) => !attachedIds.has(t.id))
      .filter(
        (t) =>
          !q ||
          t.title.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          (t.mood ?? "").toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [library, attachedIds, query]);

  function attach(trackId: string) {
    startTransition(async () => {
      const res = await attachTrackAction(videoId, trackId);
      if (res?.error) toast.error(res.error);
      else {
        setPicking(false);
        setQuery("");
        router.refresh();
      }
    });
  }

  function detach(trackId: string) {
    startTransition(async () => {
      const res = await detachTrackAction(videoId, trackId);
      if (res?.error) toast.error(res.error);
      else router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-line bg-card p-4">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Music</h2>
        <span className="text-[11px] text-ink-3">{attached.length}</span>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setPicking((v) => !v)}
            aria-label="Add a track"
            className="ml-auto rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
          >
            {picking ? <IconX size={13} /> : <IconPlus size={13} />}
          </button>
        ) : null}
      </div>
      <p className="mb-3 text-[11px] leading-snug text-ink-3">
        Everything here is cleared for use. Attaching one tells the editor exactly which track
        was meant.
      </p>

      {attached.length === 0 && !picking ? (
        <p className="rounded-lg bg-panel px-3 py-2.5 text-[11px] text-ink-3">
          No track picked yet.
        </p>
      ) : null}

      <div className="space-y-1.5">
        {attached.map((t) => (
          <div key={t.id} className="rounded-lg bg-panel p-2">
            <div className="mb-1 flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{t.title}</span>
                <span className="block truncate text-[10px] text-ink-3">
                  {[t.category, t.mood, t.bpm ? `${t.bpm} bpm` : null]
                    .filter(Boolean)
                    .join(" · ")}
                  {t.duration_seconds ? ` · ${timecode(t.duration_seconds)}` : ""}
                </span>
              </span>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => detach(t.id)}
                  disabled={pending}
                  aria-label={`Remove ${t.title}`}
                  className="shrink-0 rounded p-1 text-ink-3 hover:text-danger"
                >
                  <IconX size={11} />
                </button>
              ) : null}
            </div>
            {t.signed_url ? (
              <audio src={t.signed_url} controls preload="none" className="h-8 w-full" />
            ) : (
              <span className="text-[10px] text-ink-3">Audio unavailable.</span>
            )}
          </div>
        ))}
      </div>

      {picking && canEdit ? (
        <div className="mt-2 space-y-1.5">
          <label className="relative block">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3">
              <IconSearch size={12} />
            </span>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, category or mood…"
              className="w-full rounded-lg border border-line bg-raised py-1.5 pl-7 pr-2.5 text-xs placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
          </label>

          <div className="max-h-64 space-y-1 overflow-y-auto">
            {results.length === 0 ? (
              <p className="py-3 text-center text-[11px] text-ink-3">
                {library.length === 0 ? "The library is empty." : "Nothing matching."}
              </p>
            ) : (
              results.map((t) => (
                <div key={t.id} className="rounded-lg border border-line p-2">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs">{t.title}</span>
                      <span className="block truncate text-[10px] text-ink-3">
                        {[t.category, t.mood].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => attach(t.id)}
                      disabled={pending}
                      className="shrink-0 rounded-md bg-accent px-2 py-1 text-[10px] font-medium text-white hover:bg-accent-hi disabled:opacity-50"
                    >
                      Use this
                    </button>
                  </div>
                  {t.signed_url ? (
                    <audio src={t.signed_url} controls preload="none" className="h-7 w-full" />
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
