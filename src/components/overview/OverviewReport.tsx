"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { rankStagesAction, type StageTaskKey } from "@/app/assistant-actions";
import { useAndreas } from "@/components/andreas/AndreasProvider";
import { WhatsNew } from "@/components/overview/WhatsNew";
import {
  IconCamera,
  IconChevronRight,
  IconCheck,
  IconFile,
  IconLayers,
  IconSparkles,
} from "@/components/ui/icons";
import type { WhatsNew as WhatsNewData } from "@/app/overview-actions";

const plural = (n: number, word: string) => (n === 1 ? word : `${word}s`);

const STAGE: Record<
  StageTaskKey,
  { title: string; href: string; describe: (n: number) => string; icon: React.ReactNode; tone: string }
> = {
  ideation: {
    title: "Idea videos",
    href: "/ideation",
    describe: (n) => `Currently there ${n === 1 ? "is" : "are"} ${n} ${plural(n, "idea")} in the pipeline.`,
    icon: <IconSparkles size={16} />,
    tone: "var(--color-accent)",
  },
  scripting: {
    title: "Script videos",
    href: "/board",
    describe: (n) => `${n} ${plural(n, "idea")} ready to script.`,
    icon: <IconFile size={16} />,
    tone: "var(--color-stage-review)",
  },
  ready_to_film: {
    title: "Film videos",
    href: "/filming",
    describe: (n) => `${n} ${plural(n, "video")} ready to film.`,
    icon: <IconCamera size={16} />,
    tone: "var(--color-stage-film)",
  },
  in_review: {
    title: "Review videos",
    href: "/review",
    describe: (n) => `${n} ${plural(n, "video")} waiting on your review.`,
    icon: <IconLayers size={16} />,
    tone: "var(--color-stage-review)",
  },
  with_va: {
    title: "With the VA",
    href: "/posting",
    describe: (n) => `${n} ${plural(n, "video")} on the VA's desk to post.`,
    icon: <IconCheck size={16} />,
    tone: "var(--color-stage-with-va)",
  },
};

// Order shown the instant counts are available, before the AI ranking (which
// only ever reorders this same list) has had a chance to come back.
const FALLBACK_ORDER: StageTaskKey[] = ["in_review", "with_va", "ready_to_film", "scripting", "ideation"];

/**
 * The pipeline stages worth tackling first — ranked, not just listed — each
 * with its real count. "What's new" stays below it: this is what needs
 * doing, that's what moved without you.
 */
export function OverviewReport({
  firstName,
  counts,
  poolRunningDry,
  news,
}: {
  firstName: string;
  counts: Record<StageTaskKey, number>;
  poolRunningDry: boolean;
  news: WhatsNewData;
}) {
  const { openWith } = useAndreas();
  const [order, setOrder] = useState<StageTaskKey[]>(() => FALLBACK_ORDER.filter((k) => counts[k] > 0));
  const [ask, setAsk] = useState("");

  useEffect(() => {
    let cancelled = false;
    rankStagesAction({
      counts,
      poolRunningDry,
      activity: news.items.slice(0, 6).map((a) => ({ title: a.video_title ?? "A video", summary: a.summary })),
    }).then((res) => {
      if (!cancelled && res.length) setOrder(res);
    });
    return () => {
      cancelled = true;
    };
    // Runs once, for whatever the page loaded with — it's a snapshot, not live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submitAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!ask.trim()) return;
    openWith(ask);
    setAsk("");
  }

  return (
    <section className="space-y-4 rounded-2xl border border-line bg-card p-4">
      <div className="flex items-start gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-ghost text-accent-hi">
          <IconSparkles size={16} />
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-[15px] font-medium leading-snug">
            What should we work on{firstName ? `, ${firstName}` : ""}?
          </p>

          {order.length ? (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {order.map((key) => {
                const s = STAGE[key];
                const count = counts[key];
                return (
                  <Link
                    key={key}
                    href={s.href}
                    className="flex items-center gap-2.5 rounded-lg border border-line bg-raised px-3 py-2 text-sm transition hover:border-accent"
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                      style={{ color: s.tone, background: `color-mix(in srgb, ${s.tone} 14%, transparent)` }}
                    >
                      {s.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium leading-tight">{s.title}</span>
                      <span className="block truncate text-xs text-ink-3">{s.describe(count)}</span>
                    </span>
                    <IconChevronRight size={12} className="shrink-0 text-ink-3" />
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-ink-2">Nothing in the pipeline needs a look right now.</p>
          )}

          <form onSubmit={submitAsk} className="flex items-center gap-2">
            <input
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              placeholder="Ask Andreas about a video, a list, or top performers…"
              className="min-w-0 flex-1 rounded-lg border border-line bg-raised px-3 py-2 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={!ask.trim()}
              className="shrink-0 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hi disabled:opacity-50"
            >
              Ask
            </button>
          </form>
        </div>
      </div>

      <div className="border-t border-line pt-4">
        <WhatsNew data={news} bare />
      </div>
    </section>
  );
}
