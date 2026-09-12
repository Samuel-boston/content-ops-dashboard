import Link from "next/link";
import { IconCheck, IconChevronRight, IconClock, IconFile, IconLayers } from "@/components/ui/icons";

/**
 * The first thing on the page, on purpose: work blocked on the client
 * specifically — nothing an editor could clear — so an empty row genuinely
 * means there's nothing for them to do. Stalled/overdue videos used to live
 * here too; they're a caution in the nav now, since "something's gone quiet"
 * is a different kind of thing than "here's your actual to-do list."
 */
export function NeedsYou({
  toReview,
  toFinalReview,
  readyToPost,
  toFilm,
  poolCount,
  poolRunningDry,
}: {
  toReview: number;
  toFinalReview: number;
  readyToPost: number;
  toFilm: number;
  poolCount: number;
  poolRunningDry: boolean;
}) {
  const cards = [
    {
      show: toReview > 0,
      href: "/review",
      tone: "var(--color-stage-review)",
      icon: <IconLayers size={16} />,
      count: toReview,
      label: toReview === 1 ? "video to review" : "videos to review",
      hint: "A new cut is waiting on your notes.",
    },
    {
      show: toFinalReview > 0,
      href: "/review#final",
      tone: "var(--color-stage-final)",
      icon: <IconCheck size={16} />,
      count: toFinalReview,
      label: "in final review",
      hint: "Hook variants are in — last look before it goes out.",
    },
    {
      show: readyToPost > 0,
      href: "/review#post",
      tone: "var(--color-stage-ready-post)",
      icon: <IconChevronRight size={16} />,
      count: readyToPost,
      label: "ready to post",
      hint: "Approved and waiting to be scheduled.",
    },
    {
      show: toFilm > 0,
      href: "/filming",
      tone: "var(--color-stage-film)",
      icon: <IconFile size={16} />,
      count: toFilm,
      label: toFilm === 1 ? "video to film" : "videos to film",
      hint: "Scripted and waiting on you to shoot them.",
    },
    {
      show: poolRunningDry,
      href: "/filming",
      tone: "var(--color-warn)",
      icon: <IconClock size={16} />,
      count: poolCount,
      label: poolCount === 0 ? "left to edit — film more" : "left in the pool",
      hint: "The editors will run dry. Time to film.",
    },
  ].filter((c) => c.show);

  if (!cards.length) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-ok/30 bg-ok/5 px-4 py-3">
        <span className="text-ok">
          <IconCheck size={16} />
        </span>
        <p className="text-sm text-ink-2">
          Nothing needs you right now — everything&rsquo;s with the editors.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((c) => (
        <Link
          key={c.href + c.label}
          href={c.href}
          className="group flex items-start gap-3 rounded-xl border border-line bg-card p-4 transition hover:border-line-strong hover:bg-raised"
        >
          <span
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{
              color: c.tone,
              background: `color-mix(in srgb, ${c.tone} 14%, transparent)`,
            }}
          >
            {c.icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">
              <span className="text-lg font-semibold tabular-nums">{c.count}</span> {c.label}
            </span>
            <span className="mt-0.5 block text-xs leading-snug text-ink-3">{c.hint}</span>
          </span>
          <span className="mt-1 text-ink-3 transition group-hover:translate-x-0.5 group-hover:text-ink-2">
            <IconChevronRight size={14} />
          </span>
        </Link>
      ))}
    </div>
  );
}
