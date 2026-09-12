"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { overviewOpenerAction, type OverviewItemInput, type OverviewPick } from "@/app/assistant-actions";
import { useAndreas } from "@/components/andreas/AndreasProvider";
import { NeedsYou } from "@/components/overview/NeedsYou";
import { WhatsNew } from "@/components/overview/WhatsNew";
import { STATUS_COLOR } from "@/lib/types";
import { IconChevronRight, IconSparkles } from "@/components/ui/icons";
import type { WhatsNew as WhatsNewData } from "@/app/overview-actions";

/**
 * "Needs you" and "What's new" used to be two separate blocks doing the same
 * job — telling you where things stand — from two different angles (blocked
 * on you vs. moved without you). Above both of those, Andreas: not a
 * generated paragraph to read, but a short opener plus a handful of real,
 * clickable picks — every one of them a genuine video from the input, never
 * invented, because the server only ever lets through ids it was actually
 * given. The chips below stay as they were; this is what got added, not
 * what replaced it.
 */
export function OverviewReport({
  firstName,
  items,
  toReview,
  toFinalReview,
  readyToPost,
  toFilm,
  poolCount,
  poolRunningDry,
  news,
}: {
  firstName: string;
  items: OverviewItemInput[];
  toReview: number;
  toFinalReview: number;
  readyToPost: number;
  toFilm: number;
  poolCount: number;
  poolRunningDry: boolean;
  news: WhatsNewData;
}) {
  const { openWith } = useAndreas();
  const [loading, setLoading] = useState(true);
  const [opener, setOpener] = useState<string | null>(null);
  const [picks, setPicks] = useState<OverviewPick[]>([]);
  const [ask, setAsk] = useState("");

  useEffect(() => {
    let cancelled = false;
    overviewOpenerAction({
      firstName,
      items,
      poolRunningDry,
      activity: news.items.slice(0, 6).map((a) => ({ title: a.video_title ?? "A video", summary: a.summary })),
    }).then((res) => {
      if (cancelled) return;
      setLoading(false);
      setOpener(res.opener);
      setPicks(res.picks);
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
              <div className="h-9 animate-pulse rounded-lg bg-panel" />
              <div className="h-9 animate-pulse rounded-lg bg-panel" />
            </div>
          ) : picks.length ? (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {picks.map((p) => (
                <Link
                  key={p.id}
                  href={p.href}
                  className="flex items-center gap-2 rounded-lg border border-line bg-raised px-3 py-2 text-sm transition hover:border-accent"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[p.status] }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium leading-tight">{p.title}</span>
                    <span className="block truncate text-xs text-ink-3">{p.label}</span>
                  </span>
                  <IconChevronRight size={12} className="shrink-0 text-ink-3" />
                </Link>
              ))}
            </div>
          ) : null}

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
        <NeedsYou
          toReview={toReview}
          toFinalReview={toFinalReview}
          readyToPost={readyToPost}
          toFilm={toFilm}
          poolCount={poolCount}
          poolRunningDry={poolRunningDry}
        />
      </div>

      <div className="border-t border-line pt-4">
        <WhatsNew data={news} bare />
      </div>
    </section>
  );
}
