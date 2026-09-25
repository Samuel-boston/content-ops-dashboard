"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import type { LibraryShot } from "@/lib/types";

function fmtDuration(s: number | null) {
  if (s === null || s <= 0) return null;
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}

/**
 * One shot, as a card: the analysed frame, what's happening in it, and the
 * shortest path to using it — open in Drive (deep-linked to the shot's
 * timestamp for videos) or copy that link into a brief.
 */
export function ShotCard({
  shot,
  action,
}: {
  shot: LibraryShot;
  /** Optional extra control (the slide picker injects its "Use" button). */
  action?: React.ReactNode;
}) {
  const toast = useToast();
  const driveLink =
    shot.drive_web_link && shot.start_s && shot.start_s > 0.5
      ? `${shot.drive_web_link}#t=${Math.floor(shot.start_s)}`
      : shot.drive_web_link;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card">
      <div className="relative aspect-video bg-raised">
        {shot.thumb_url ? (
          // Signed Supabase Storage URL, short-lived — next/image would fight the expiry.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot.thumb_url} alt={shot.caption ?? ""} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-ink-3">no frame</div>
        )}
        <div className="absolute left-1.5 top-1.5 flex gap-1">
          {shot.top_pick ? <span title="Top pick">⭐</span> : null}
          <span className="rounded bg-black/60 px-1 py-0.5 text-[9px] font-semibold uppercase text-white">
            {shot.media_kind}
          </span>
        </div>
        {fmtDuration(shot.duration_s) ? (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1 py-0.5 font-mono text-[10px] text-white">
            {fmtDuration(shot.duration_s)}
          </span>
        ) : null}
      </div>
      <div className="space-y-1.5 p-2.5">
        <p className="line-clamp-2 text-xs leading-relaxed text-ink">{shot.caption ?? shot.filename}</p>
        <div className="flex flex-wrap gap-1">
          {(shot.emotions ?? []).slice(0, 3).map((e) => (
            <span key={e} className="rounded-full border border-line px-1.5 py-0.5 text-[9px] text-ink-3">
              {e}
            </span>
          ))}
          {shot.category ? (
            <span className="truncate rounded-full border border-line px-1.5 py-0.5 text-[9px] text-ink-3">
              {shot.category.split("/").pop()}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 pt-0.5">
          {driveLink ? (
            <a href={driveLink} target="_blank" rel="noreferrer" className="text-[11px] text-accent hover:underline">
              Open in Drive ↗
            </a>
          ) : (
            <span className="text-[11px] text-ink-3">not in Drive yet</span>
          )}
          {driveLink ? (
            <button
              onClick={() =>
                navigator.clipboard
                  .writeText(driveLink)
                  .then(() => toast.success("Link copied."))
                  .catch(() => toast.error("Couldn't copy."))
              }
              className="text-[11px] text-ink-3 hover:text-ink"
            >
              Copy link
            </button>
          ) : null}
          <span className="ml-auto">{action}</span>
        </div>
      </div>
    </div>
  );
}

export function VisualsBrowser({
  shots,
  facets,
  initial,
}: {
  shots: LibraryShot[];
  facets: { emotions: string[]; categories: string[]; total: number };
  initial: { q: string; media: "video" | "image" | ""; emotion: string; topPicks: boolean };
}) {
  const router = useRouter();
  const [q, setQ] = useState(initial.q);

  function apply(next: Partial<typeof initial>) {
    const merged = { ...initial, q, ...next };
    const params = new URLSearchParams({ view: "search" });
    if (merged.q) params.set("q", merged.q);
    if (merged.media) params.set("media", merged.media);
    if (merged.emotion) params.set("emotion", merged.emotion);
    if (merged.topPicks) params.set("top", "1");
    router.push(`/library/visuals?${params}`);
  }

  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-1 text-[11px] transition ${
      active ? "border-accent bg-accent/10 text-ink" : "border-line text-ink-2 hover:border-accent hover:text-ink"
    }`;

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply({});
        }}
        className="flex gap-2"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder='Search what happens in the shot — "journaling calm morning", "walking at sunset"…'
          className="min-w-0 flex-1 rounded-lg border border-line-strong bg-raised px-3 py-2 text-sm outline-none placeholder:text-ink-3 focus:border-accent"
        />
        <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hi">
          Search
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-1.5">
        <button className={chip(initial.media === "video")} onClick={() => apply({ media: "video" })}>
          Videos
        </button>
        <button className={chip(initial.media === "image")} onClick={() => apply({ media: "image" })}>
          Images
        </button>
        <button className={chip(!initial.media)} onClick={() => apply({ media: "" })}>
          All
        </button>
        <button className={chip(initial.topPicks)} onClick={() => apply({ topPicks: !initial.topPicks })}>
          ⭐ Top picks
        </button>
        <span className="mx-1 h-4 w-px bg-line" />
        {facets.emotions.slice(0, 10).map((e) => (
          <button key={e} className={chip(initial.emotion === e)} onClick={() => apply({ emotion: initial.emotion === e ? "" : e })}>
            {e}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-ink-3">{facets.total} shots indexed</span>
      </div>

      {shots.length === 0 ? (
        <div className="rounded-xl border border-line bg-card px-4 py-14 text-center text-sm text-ink-3">
          {facets.total === 0 ? (
            <>
              Nothing synced yet. Connect the B-Roll Librarian once with{" "}
              <code className="rounded bg-raised px-1.5 py-0.5 text-xs">broll connect-dashboard</code>{" "}
              and the whole archive lands here, then stays up to date by itself.
            </>
          ) : (
            "No shots match — try fewer words, or drop a filter."
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {shots.map((s) => (
            <ShotCard key={s.id} shot={s} />
          ))}
        </div>
      )}
    </div>
  );
}
