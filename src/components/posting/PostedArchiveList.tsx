"use client";

import { useMemo, useState } from "react";
import { buildMonthGrid, iso, shiftMonth } from "@/lib/calendar";
import type { PostedVideoRow } from "@/app/posting-actions";
import { PostedVideoDialog } from "@/components/posting/PostingDialogs";

/** Every posted video that went through the VA: search it, open one for performance and to post the best trial to the feed. */
export function PostedArchiveList({ rows, clientName, query }: { rows: PostedVideoRow[]; clientName: string; query: string }) {
  const [open, setOpen] = useState<{ id: string; title: string } | null>(null);
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => !q || r.title.toLowerCase().includes(q));
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-ink-3">
        Everything that&rsquo;s been posted. Open a video to add performance, see which trial is winning, and post it to the main feed.
      </p>
      {shown.length === 0 ? (
        <p className="rounded-xl border border-line bg-card px-4 py-8 text-center text-sm text-ink-3">Nothing in the archive yet.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-card">
          {shown.map((r) => (
            <button
              key={r.videoId}
              type="button"
              onClick={() => setOpen({ id: r.videoId, title: r.title })}
              className="flex w-full flex-wrap items-center gap-3 border-b border-line px-4 py-2.5 text-left last:border-0 hover:bg-hover"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.title}</span>
              <span className="text-[11px] text-ink-3">
                {r.variants} variant{r.variants === 1 ? "" : "s"}
                {r.trialsLive ? ` · ${r.trialsLive} trial` : ""}
                {r.onFeed ? ` · ${r.onFeed} on feed` : ""}
              </span>
              {r.best ? <span className="text-[11px] text-ink-2">🏆 {r.best.label} · {r.best.views.toLocaleString()} views</span> : null}
              <span className="text-[11px] text-ink-3">
                {r.postedAt ? new Date(r.postedAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : ""}
              </span>
            </button>
          ))}
        </div>
      )}
      {open ? <PostedVideoDialog videoId={open.id} title={open.title} clientName={clientName} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/**
 * The VA's own Archive page — the same as the client's: a month calendar by default
 * (each video sits on the day it was posted), with a list view and search.
 */
export function VaArchive({ rows, clientName }: { rows: PostedVideoRow[]; clientName: string }) {
  const now = new Date();
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [query, setQuery] = useState("");
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [open, setOpen] = useState<{ id: string; title: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => !q || r.title.toLowerCase().includes(q));
  const grid = useMemo(() => buildMonthGrid(ym.y, ym.m), [ym]);
  const prev = shiftMonth(ym.y, ym.m, -1);
  const next = shiftMonth(ym.y, ym.m, 1);
  const monthLabel = new Date(ym.y, ym.m, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
  const todayISO = iso(now);

  const byDay = useMemo(() => {
    const map = new Map<string, PostedVideoRow[]>();
    for (const r of shown) {
      if (!r.postedAt) continue;
      const key = iso(new Date(r.postedAt));
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return map;
  }, [shown]);

  const btn = "rounded-md border border-line px-2.5 py-1.5 text-sm hover:bg-hover";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-line-strong">
          {(["list", "calendar"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-sm capitalize ${view === v ? "bg-hover text-ink" : "bg-card text-ink-2"}`}
            >
              {v}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search posted videos…"
          className="w-56 rounded-md border border-line-strong bg-raised px-2 py-1.5 text-sm outline-none placeholder:text-ink-3 focus:border-accent"
        />
      </div>

      {view === "list" ? (
        <PostedArchiveList rows={rows} clientName={clientName} query={query} />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{monthLabel}</h2>
            <div className="flex gap-1">
              <button type="button" className={btn} onClick={() => setYm({ y: prev.year, m: prev.month })}>
                ← Prev
              </button>
              <button type="button" className={btn} onClick={() => setYm({ y: now.getFullYear(), m: now.getMonth() })}>
                Today
              </button>
              <button type="button" className={btn} onClick={() => setYm({ y: next.year, m: next.month })}>
                Next →
              </button>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-line bg-app">
            <div className="grid grid-cols-7 border-b border-line">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div key={d} className="px-2 py-1.5 text-[11px] font-medium text-ink-3">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {grid.weeks.flat().map((date, i) => {
                const key = date ? iso(date) : `empty-${i}`;
                const list = date ? byDay.get(iso(date)) ?? [] : [];
                const all = expanded === key;
                const visible = all ? list : list.slice(0, 3);
                return (
                  <div
                    key={key}
                    className={`min-h-[104px] border-b border-r border-line p-1.5 ${date && iso(date) === todayISO ? "bg-card/60" : ""}`}
                  >
                    {date ? (
                      <>
                        <div className="text-[11px] text-ink-3">{date.getDate()}</div>
                        <div className="mt-1 space-y-0.5">
                          {visible.map((r) => (
                            <button
                              key={r.videoId}
                              type="button"
                              title={r.title}
                              onClick={() => setOpen({ id: r.videoId, title: r.title })}
                              className="block w-full truncate rounded bg-ok/10 px-1 py-0.5 text-left text-[11px] text-ok hover:bg-ok/20"
                            >
                              {r.title}
                            </button>
                          ))}
                          {list.length > 3 ? (
                            <button
                              type="button"
                              onClick={() => setExpanded(all ? null : key)}
                              className="text-[10px] text-ink-3 hover:text-ink-2"
                            >
                              {all ? "Show less" : `+${list.length - 3} more`}
                            </button>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {open ? <PostedVideoDialog videoId={open.id} title={open.title} clientName={clientName} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
