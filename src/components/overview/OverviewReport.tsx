"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { overviewOpenerAction, type StageTask, type StageTaskKey } from "@/app/assistant-actions";
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

const TASK_ICON: Record<StageTaskKey, React.ReactNode> = {
  ideation: <IconSparkles size={16} />,
  scripting: <IconFile size={16} />,
  ready_to_film: <IconCamera size={16} />,
  in_review: <IconLayers size={16} />,
  ready_to_post: <IconCheck size={16} />,
};

const TASK_TONE: Record<StageTaskKey, string> = {
  ideation: "var(--color-accent)",
  scripting: "var(--color-stage-review)",
  ready_to_film: "var(--color-stage-film)",
  in_review: "var(--color-stage-review)",
  ready_to_post: "var(--color-stage-ready-post)",
};

/**
 * Andreas opens with one short line, then the pipeline stages that actually
 * need attention — ranked, not just listed — each a real count from the
 * board, never an invented one. "What's new" stays below it: this is what's
 * blocked or backing up, that's what moved without you.
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
  const [loading, setLoading] = useState(true);
  const [opener, setOpener] = useState<string | null>(null);
  const [tasks, setTasks] = useState<StageTask[]>([]);
  const [ask, setAsk] = useState("");

  useEffect(() => {
    let cancelled = false;
    overviewOpenerAction({
      firstName,
      counts,
      poolRunningDry,
      activity: news.items.slice(0, 6).map((a) => ({ title: a.video_title ?? "A video", summary: a.summary })),
    }).then((res) => {
      if (cancelled) return;
      setLoading(false);
      setOpener(res.opener);
      setTasks(res.tasks);
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
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Andreas</span>
            {loading ? (
              <div className="mt-1.5 h-4 w-2/3 animate-pulse rounded bg-panel" />
            ) : (
              <p className="mt-0.5 text-[15px] font-medium leading-snug">{opener}</p>
            )}
          </div>

          {loading ? (
            <div className="grid gap-1.5 sm:grid-cols-2">
              <div className="h-12 animate-pulse rounded-lg bg-panel" />
              <div className="h-12 animate-pulse rounded-lg bg-panel" />
            </div>
          ) : tasks.length ? (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {tasks.map((t) => (
                <Link
                  key={t.key}
                  href={t.href}
                  className="flex items-center gap-2.5 rounded-lg border border-line bg-raised px-3 py-2 text-sm transition hover:border-accent"
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                    style={{
                      color: TASK_TONE[t.key],
                      background: `color-mix(in srgb, ${TASK_TONE[t.key]} 14%, transparent)`,
                    }}
                  >
                    {TASK_ICON[t.key]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium leading-tight">
                      <span className="tabular-nums">{t.count}</span> {t.label}
                    </span>
                    <span className="block truncate text-xs text-ink-3">{t.note}</span>
                  </span>
                  <IconChevronRight size={12} className="shrink-0 text-ink-3" />
                </Link>
              ))}
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
