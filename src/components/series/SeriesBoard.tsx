"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import {
  createSeriesAction,
  deleteSeriesAction,
  moveInSeriesAction,
} from "@/app/series-actions";
import { IconChevronDown, IconChevronRight, IconPlus, IconTrash } from "@/components/ui/icons";
import { dayMonth } from "@/lib/format";
import { STATUS_COLOR, STATUS_LABELS, type SeriesWithVideos } from "@/lib/types";

/**
 * Series, each with its parts in story order.
 *
 * The order shown here is the order they're meant to go out in, which is the
 * whole point: a run of videos where part three landing before part two makes
 * no sense. Post dates are shown beside each part so an ordering that
 * contradicts the calendar is visible rather than discovered later.
 */
export function SeriesBoard({ series }: { series: SeriesWithVideos[] }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");

  function create() {
    startTransition(async () => {
      const res = await createSeriesAction(title, note);
      if (res?.error) toast.error(res.error);
      else {
        setTitle("");
        setNote("");
        setAdding(false);
        toast.success("Series created.");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Series</h1>
          <p className="text-sm text-ink-2">
            {series.length === 0
              ? "Group videos that belong together and go out in order."
              : `${series.length} series · ${series.reduce((n, s) => n + s.videos.length, 0)} parts`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white transition hover:bg-accent-hi"
        >
          <IconPlus size={13} />
          New series
        </button>
      </div>

      {adding ? (
        <div className="space-y-2 rounded-xl border border-accent/40 bg-accent-ghost p-4">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && title.trim()) create();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="What's the series called?"
            className="w-full rounded-lg border border-line bg-raised px-3 py-2 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What it's about (optional)"
            className="w-full rounded-lg border border-line bg-raised px-3 py-2 text-xs placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={pending || !title.trim()}
              onClick={create}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hi disabled:opacity-40"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-3 hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {series.length === 0 && !adding ? (
        <div className="rounded-xl border border-dashed border-line-strong px-4 py-12 text-center">
          <p className="text-sm text-ink-2">No series yet.</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-ink-3">
            A series is a run of videos meant to be watched in order &mdash; a multi-part story, a
            launch sequence. Create one here, then add videos to it from their own page.
          </p>
        </div>
      ) : null}

      <div className="space-y-4">
        {series.map((s) => (
          <section key={s.id} className="overflow-hidden rounded-xl border border-line bg-card">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold">{s.title}</h2>
              <span className="text-[11px] text-ink-3">
                {s.videos.length} part{s.videos.length === 1 ? "" : "s"}
              </span>
              {s.note ? <span className="text-[11px] text-ink-3">{s.note}</span> : null}
              <button
                type="button"
                onClick={() =>
                  startTransition(async () => {
                    const res = await deleteSeriesAction(s.id);
                    if (res?.error) toast.error(res.error);
                    else {
                      toast.success("Series removed — its videos are untouched.");
                      router.refresh();
                    }
                  })
                }
                aria-label={`Delete ${s.title}`}
                className="ml-auto rounded p-1 text-ink-3 transition hover:text-danger"
              >
                <IconTrash size={12} />
              </button>
            </div>

            {s.videos.length === 0 ? (
              <p className="px-4 py-5 text-center text-[11px] text-ink-3">
                Nothing in this series yet. Open a video and pick it from the Series box.
              </p>
            ) : (
              <ol className="divide-y divide-line">
                {s.videos.map((v, i) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                    <span className="w-6 shrink-0 font-mono text-xs text-ink-3">{i + 1}</span>
                    <Link
                      href={`/videos/${v.id}`}
                      className="min-w-0 flex-1 truncate text-sm hover:text-accent-hi"
                    >
                      {v.title}
                    </Link>
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                      style={{
                        color: STATUS_COLOR[v.status],
                        background: `color-mix(in srgb, ${STATUS_COLOR[v.status]} 12%, transparent)`,
                      }}
                    >
                      {STATUS_LABELS[v.status]}
                    </span>
                    <span className="w-16 shrink-0 text-right text-[10px] tabular-nums text-ink-3">
                      {v.post_date ? dayMonth(v.post_date) : "no date"}
                    </span>
                    <span className="flex shrink-0 items-center">
                      <button
                        type="button"
                        disabled={pending || i === 0}
                        onClick={() =>
                          startTransition(async () => {
                            const res = await moveInSeriesAction(v.id, "up");
                            if (res?.error) toast.error(res.error);
                            else router.refresh();
                          })
                        }
                        aria-label={`Move ${v.title} earlier`}
                        className="rotate-180 rounded p-1 text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-25"
                      >
                        <IconChevronDown size={12} />
                      </button>
                      <button
                        type="button"
                        disabled={pending || i === s.videos.length - 1}
                        onClick={() =>
                          startTransition(async () => {
                            const res = await moveInSeriesAction(v.id, "down");
                            if (res?.error) toast.error(res.error);
                            else router.refresh();
                          })
                        }
                        aria-label={`Move ${v.title} later`}
                        className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-25"
                      >
                        <IconChevronDown size={12} />
                      </button>
                      <IconChevronRight size={12} className="ml-1 text-ink-3" />
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
