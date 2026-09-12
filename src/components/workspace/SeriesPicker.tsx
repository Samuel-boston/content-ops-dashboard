"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { setVideoSeriesAction } from "@/app/series-actions";
import type { Series } from "@/lib/types";

/**
 * Which series this video belongs to.
 *
 * Adding puts it on the end of the run, which is what "add to this series"
 * nearly always means; the order is then adjusted on the Series page, where
 * you can see the whole sequence at once rather than guessing a number here.
 */
export function SeriesPicker({
  videoId,
  seriesId,
  position,
  options,
  canEdit,
}: {
  videoId: string;
  seriesId: string | null;
  position: number | null;
  options: Series[];
  canEdit: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();

  const current = options.find((s) => s.id === seriesId) ?? null;

  // Nothing to say to an editor on a standalone video.
  if (!canEdit && !current) return null;

  return (
    <section className="rounded-xl border border-line bg-card p-4">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Series</h2>

      {current ? (
        <p className="mb-2 text-xs text-ink-2">
          <Link href="/series" className="font-medium text-ink hover:text-accent-hi">
            {current.title}
          </Link>
          {position !== null ? <span className="text-ink-3"> · part {position}</span> : null}
        </p>
      ) : null}

      {canEdit ? (
        <select
          value={seriesId ?? ""}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.value || null;
            startTransition(async () => {
              const res = await setVideoSeriesAction(videoId, next);
              if (res?.error) toast.error(res.error);
              else {
                toast.success(next ? "Added to the series." : "Removed from the series.");
                router.refresh();
              }
            });
          }}
          className="w-full min-w-0 truncate rounded-lg border border-line bg-raised px-2.5 py-1.5 text-xs focus:border-accent focus:outline-none disabled:opacity-50"
        >
          <option value="">Not part of a series</option>
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      ) : null}

      {canEdit && options.length === 0 ? (
        <p className="mt-2 text-[11px] text-ink-3">
          No series yet &mdash; <Link href="/series" className="text-accent-hi hover:underline">create one</Link>.
        </p>
      ) : null}
    </section>
  );
}
