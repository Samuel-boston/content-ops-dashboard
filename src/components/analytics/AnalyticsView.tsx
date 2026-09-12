"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { IconChart, IconSparkles, IconX } from "@/components/ui/icons";
import { displayName } from "@/lib/format";
import {
  applyFilters,
  byMonth,
  findOutliers,
  groupByLength,
  groupByTag,
  groupByWeekday,
  LENGTH_BUCKETS,
  median,
  whatsWorking,
  type Filters,
  type Group,
  type Insight,
} from "@/lib/insights";
import type { Profile } from "@/lib/types";

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

/* ------------------------------------------------------------- bar chart -- */

function GroupBars({
  title,
  hint,
  groups,
  metric,
  onPick,
  activeKey,
}: {
  title: string;
  hint?: string;
  groups: Group[];
  metric: "avgViews" | "avgEngagement";
  onPick?: (key: string) => void;
  activeKey?: string;
}) {
  const max = Math.max(1, ...groups.map((g) => g[metric]));

  return (
    <section className="rounded-xl border border-line bg-card p-4">
      <div className="mb-1 flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-ink-3">
          {metric === "avgViews" ? "avg views" : "avg engagement"}
        </span>
      </div>
      {hint ? <p className="mb-3 text-[11px] text-ink-3">{hint}</p> : null}

      {groups.length === 0 ? (
        <p className="py-6 text-center text-xs text-ink-3">Not enough posted work yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map((g) => {
            const value = g[metric];
            const active = activeKey === g.key;
            return (
              <button
                key={g.key}
                type="button"
                disabled={!onPick}
                onClick={() => onPick?.(g.key)}
                className={`group grid grid-cols-[7.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 rounded-md px-1 py-0.5 text-left transition ${
                  onPick ? "hover:bg-hover" : ""
                } ${active ? "bg-accent-ghost" : ""}`}
              >
                <span className="truncate text-xs text-ink-2">{g.label}</span>
                <span className="h-4 overflow-hidden rounded-sm bg-panel">
                  <span
                    className="block h-full rounded-sm transition-all"
                    style={{
                      width: `${Math.max(2, (value / max) * 100)}%`,
                      background: active ? "var(--color-accent-hi)" : "var(--color-accent)",
                    }}
                  />
                </span>
                <span className="text-right text-xs tabular-nums text-ink-2">
                  {metric === "avgViews" ? compact(value) : `${(value * 100).toFixed(1)}%`}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- scatter --- */

function LengthScatter({ rows }: { rows: Insight[] }) {
  const points = rows.filter((r) => r.durationSeconds != null && r.views > 0);
  const maxLen = Math.max(60, ...points.map((p) => p.durationSeconds ?? 0));
  const maxViews = Math.max(1, ...points.map((p) => p.views));

  return (
    <section className="rounded-xl border border-line bg-card p-4">
      <h3 className="mb-1 text-sm font-semibold">Length against reach</h3>
      <p className="mb-3 text-[11px] text-ink-3">
        Every posted video as a dot — the shape is what averages hide.
      </p>
      {points.length < 3 ? (
        <p className="py-8 text-center text-xs text-ink-3">
          Needs at least three posted videos with a duration.
        </p>
      ) : (
        <div className="relative h-48 rounded-lg bg-panel p-2">
          {/* faint grid */}
          {[0.25, 0.5, 0.75].map((f) => (
            <span
              key={f}
              className="absolute inset-x-2 border-t border-line"
              style={{ top: `${f * 100}%` }}
            />
          ))}
          {points.map((p) => (
            <Link
              key={p.id}
              href={`/videos/${p.id}`}
              title={`${p.title} — ${Math.round(p.durationSeconds ?? 0)}s, ${compact(p.views)} views`}
              className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent transition hover:scale-150 hover:bg-accent-hi"
              style={{
                left: `${8 + ((p.durationSeconds ?? 0) / maxLen) * 84}%`,
                top: `${92 - (p.views / maxViews) * 84}%`,
              }}
            />
          ))}
          <span className="absolute bottom-1 left-2 text-[10px] text-ink-3">0s</span>
          <span className="absolute bottom-1 right-2 text-[10px] text-ink-3">
            {Math.round(maxLen)}s
          </span>
          <span className="absolute left-2 top-1 text-[10px] text-ink-3">
            {compact(maxViews)} views
          </span>
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- main --- */

export function AnalyticsView({
  rows,
  editors,
  pillars,
  formats,
  platforms,
  hooks,
}: {
  rows: Insight[];
  editors: Pick<Profile, "id" | "full_name" | "email">[];
  pillars: string[];
  formats: string[];
  platforms: string[];
  hooks: {
    videoId: string;
    videoTitle: string;
    variants: { cutId: string; label: string; notes: string | null; views: number | null; linked: boolean }[];
  }[];
}) {
  const [filters, setFilters] = useState<Filters>({});

  const filtered = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const summary = useMemo(() => whatsWorking(filtered), [filtered]);
  const outliers = useMemo(() => findOutliers(filtered), [filtered]);
  const months = useMemo(() => byMonth(filtered), [filtered]);
  const med = useMemo(() => median(filtered.map((r) => r.views).filter(Boolean)), [filtered]);

  const activeCount = Object.values(filters).filter(Boolean).length;
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  const totals = filtered.reduce(
    (a, r) => ({
      views: a.views + r.views,
      reach: a.reach + r.reach,
      saves: a.saves + r.saves,
      shares: a.shares + r.shares,
    }),
    { views: 0, reach: 0, saves: 0, shares: 0 }
  );

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card p-3">
        {[
          { key: "pillar" as const, label: "Pillar", options: pillars },
          { key: "format" as const, label: "Format", options: formats },
          { key: "platform" as const, label: "Platform", options: platforms },
        ].map((f) => (
          <select
            key={f.key}
            value={filters[f.key] ?? ""}
            onChange={(e) => set({ [f.key]: e.target.value || undefined })}
            className="rounded-lg border border-line bg-raised px-2 py-1.5 text-xs focus:border-accent focus:outline-none"
          >
            <option value="">Any {f.label.toLowerCase()}</option>
            {f.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ))}

        <select
          value={filters.lengthBucket ?? ""}
          onChange={(e) => set({ lengthBucket: e.target.value || undefined })}
          className="rounded-lg border border-line bg-raised px-2 py-1.5 text-xs focus:border-accent focus:outline-none"
        >
          <option value="">Any length</option>
          {LENGTH_BUCKETS.map((b) => (
            <option key={b.key} value={b.key}>
              {b.label}
            </option>
          ))}
        </select>

        <select
          value={filters.editorId ?? ""}
          onChange={(e) => set({ editorId: e.target.value || undefined })}
          className="rounded-lg border border-line bg-raised px-2 py-1.5 text-xs focus:border-accent focus:outline-none"
        >
          <option value="">Any editor</option>
          {editors.map((e) => (
            <option key={e.id} value={e.id}>
              {displayName(e)}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={filters.from ?? ""}
          onChange={(e) => set({ from: e.target.value || undefined })}
          className="rounded-lg border border-line bg-raised px-2 py-1.5 text-xs [color-scheme:dark] focus:border-accent focus:outline-none"
        />
        <input
          type="date"
          value={filters.to ?? ""}
          onChange={(e) => set({ to: e.target.value || undefined })}
          className="rounded-lg border border-line bg-raised px-2 py-1.5 text-xs [color-scheme:dark] focus:border-accent focus:outline-none"
        />

        {activeCount > 0 ? (
          <button
            type="button"
            onClick={() => setFilters({})}
            className="flex items-center gap-1 rounded-lg border border-line px-2 py-1.5 text-xs text-ink-2 hover:bg-hover hover:text-ink"
          >
            <IconX size={11} />
            Clear {activeCount}
          </button>
        ) : null}

        <span className="ml-auto text-xs text-ink-3">
          {filtered.length} of {rows.length} posted
        </span>
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Views", value: compact(totals.views) },
          { label: "Reach", value: compact(totals.reach) },
          { label: "Saves", value: compact(totals.saves) },
          { label: "Median views", value: compact(med) },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-line bg-card px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wider text-ink-3">{s.label}</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      {/* What's working */}
      {summary ? (
        <div className="flex items-start gap-3 rounded-xl border border-accent-line bg-accent-ghost p-4">
          <span className="mt-0.5 text-accent-hi">
            <IconSparkles size={18} />
          </span>
          <div>
            <p className="text-sm font-medium">{summary.line}</p>
            <p className="mt-0.5 text-[11px] text-ink-3">
              Based on {filtered.filter((r) => r.views > 0).length} posted videos with numbers
              attached.
            </p>
          </div>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-3 text-xs text-ink-3">
          Once four or more videos have Instagram numbers attached, a plain-English summary of
          what&rsquo;s working appears here.
        </p>
      )}

      {/* Breakdowns */}
      <div className="grid gap-3 lg:grid-cols-2">
        <GroupBars
          title="Best length"
          hint="Average views per duration bucket. Click one to filter everything by it."
          groups={groupByLength(filtered)}
          metric="avgViews"
          activeKey={filters.lengthBucket}
          onPick={(k) => set({ lengthBucket: filters.lengthBucket === k ? undefined : k })}
        />
        <GroupBars
          title="By content pillar"
          groups={groupByTag(filtered, "pillars")}
          metric="avgViews"
          activeKey={filters.pillar}
          onPick={(k) => set({ pillar: filters.pillar === k ? undefined : k })}
        />
        <GroupBars
          title="By format"
          groups={groupByTag(filtered, "formats")}
          metric="avgViews"
          activeKey={filters.format}
          onPick={(k) => set({ format: filters.format === k ? undefined : k })}
        />
        <GroupBars
          title="Best day to post"
          hint="Average views by the day the video went out."
          groups={groupByWeekday(filtered)}
          metric="avgViews"
        />
      </div>

      <LengthScatter rows={filtered} />

      {/* Month on month */}
      <section className="rounded-xl border border-line bg-card p-4">
        <h3 className="mb-1 text-sm font-semibold">Month on month</h3>
        <p className="mb-3 text-[11px] text-ink-3">Average views per video posted that month.</p>
        {months.length < 2 ? (
          <p className="py-6 text-center text-xs text-ink-3">Needs at least two months of posts.</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="flex min-w-max items-end gap-2" style={{ height: 120 }}>
              {months.map((m) => {
                const max = Math.max(1, ...months.map((x) => x.avgViews));
                return (
                  <div key={m.month} className="flex w-14 flex-col items-center gap-1">
                    <span className="text-[10px] tabular-nums text-ink-3">
                      {compact(m.avgViews)}
                    </span>
                    <span
                      className="w-full rounded-t bg-accent"
                      style={{ height: `${Math.max(4, (m.avgViews / max) * 78)}px` }}
                    />
                    <span className="text-[10px] text-ink-3">{m.month.slice(5)}</span>
                    <span className="text-[9px] text-ink-3">{m.count}×</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Outliers */}
      <section>
        <h3 className="mb-2 text-sm font-semibold">Outliers</h3>
        {outliers.length === 0 ? (
          <p className="rounded-xl border border-line bg-card px-4 py-6 text-center text-xs text-ink-3">
            Nothing has beaten the median by enough to call it an outlier yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-app">
            {outliers.slice(0, 6).map((o) => (
              <Link
                key={o.insight.id}
                href={`/videos/${o.insight.id}`}
                className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-hover/40"
              >
                <span className="rounded-md bg-ok/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-ok">
                  {o.multiple.toFixed(1)}×
                </span>
                <span className="min-w-[140px] flex-1 truncate text-sm">{o.insight.title}</span>
                <span className="text-xs tabular-nums text-ink-2">
                  {compact(o.insight.views)} views
                </span>
                <span className="flex flex-wrap gap-1">
                  {o.reasons.map((r) => (
                    <span key={r} className="rounded bg-raised px-1.5 py-0.5 text-[10px] text-ink-3">
                      {r}
                    </span>
                  ))}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Hook performance */}
      <section>
        <h3 className="mb-1 text-sm font-semibold">Hook performance</h3>
        <p className="mb-2 text-[11px] leading-relaxed text-ink-3">
          Instagram reports per post, not per cut — so a variant only gets its own numbers once
          it&rsquo;s been posted and linked to its own media id in the video&rsquo;s Chat tab.
          Unlinked variants are shown so the gaps are obvious.
        </p>
        {hooks.length === 0 ? (
          <p className="rounded-xl border border-line bg-card px-4 py-6 text-center text-xs text-ink-3">
            No posted video has more than one hook yet.
          </p>
        ) : (
          <div className="space-y-2">
            {hooks.map((h) => (
              <div key={h.videoId} className="rounded-xl border border-line bg-card p-3">
                <Link
                  href={`/videos/${h.videoId}`}
                  className="text-xs font-medium hover:text-accent-hi"
                >
                  {h.videoTitle}
                </Link>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {h.variants.map((v) => (
                    <div
                      key={v.cutId}
                      className="flex items-center gap-2 rounded-lg bg-panel px-2.5 py-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs">{v.label}</span>
                        {v.notes ? (
                          <span className="block truncate text-[10px] text-ink-3">{v.notes}</span>
                        ) : null}
                      </span>
                      {v.linked ? (
                        <span className="shrink-0 text-xs font-semibold tabular-nums">
                          {compact(v.views ?? 0)}
                        </span>
                      ) : (
                        <span className="shrink-0 text-[10px] text-ink-3">not linked</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Export */}
      <ExportButton rows={filtered} />
    </div>
  );
}

/* -------------------------------------------------------------- export --- */

function ExportButton({ rows }: { rows: Insight[] }) {
  function download() {
    const header = [
      "Title", "Posted", "Length (s)", "Pillars", "Formats", "Platforms",
      "Views", "Reach", "Likes", "Comments", "Shares", "Saves", "Engagement %",
    ];
    const body = rows.map((r) =>
      [
        r.title,
        r.postDate ?? r.postedAt?.slice(0, 10) ?? "",
        r.durationSeconds ?? "",
        r.pillars.join(" | "),
        r.formats.join(" | "),
        r.platforms.join(" | "),
        r.views, r.reach, r.likes, r.comments, r.shares, r.saves,
        (r.engagementRate * 100).toFixed(2),
      ]
        // Quote everything and double any inner quotes — titles contain commas.
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(",")
    );
    const blob = new Blob([[header.join(","), ...body].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `content-ops-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card p-3">
      <IconChart size={15} className="text-ink-3" />
      <span className="text-xs text-ink-2">
        Export the {rows.length} filtered video{rows.length === 1 ? "" : "s"}
      </span>
      <button
        type="button"
        onClick={download}
        className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hi"
      >
        Download CSV
      </button>
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:bg-hover hover:text-ink"
      >
        Print / PDF
      </button>
    </div>
  );
}
