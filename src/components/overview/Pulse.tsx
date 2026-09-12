import Link from "next/link";
import { STATUS_COLOR } from "@/lib/types";
import type { Performance, Runway } from "@/app/overview-actions";

/** Positional, matching the fixed order `runway()` builds `depth` in. */
const DEPTH_COLOR = [
  STATUS_COLOR.ideation,
  STATUS_COLOR.scripting,
  STATUS_COLOR.ready_to_film,
  STATUS_COLOR.editor_brief,
  STATUS_COLOR.ready_to_edit,
];

/** 31,079 → 31.1k. Overview numbers are for glancing at, not auditing. */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-[10px] uppercase tracking-wider text-ink-3">{label}</span>
      <span className="mt-0.5 block truncate text-lg font-semibold tabular-nums">{value}</span>
      {hint ? <span className="block truncate text-[10px] text-ink-3">{hint}</span> : null}
    </div>
  );
}

const MONTH_LABEL = new Intl.DateTimeFormat(undefined, { month: "short" });

/**
 * Views over the last six months, as a proper line — a striped chart floor
 * (alternating row bands) instead of bare axis lines, so the eye can read a
 * value's height without hunting for gridlines. No charting library: six
 * points is a `<path>`, not a dependency.
 */
function MonthlyViewsLine({ monthly }: { monthly: { month: string; views: number; posts: number }[] }) {
  const anyPosts = monthly.some((m) => m.posts > 0);
  if (!anyPosts) return null;

  const W = 600;
  const H = 140;
  const PAD_X = 8;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 22;
  const max = Math.max(1, ...monthly.map((m) => m.views));
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_TOP - PAD_BOTTOM;
  const stepX = monthly.length > 1 ? innerW / (monthly.length - 1) : 0;

  const points = monthly.map((m, i) => ({
    x: PAD_X + i * stepX,
    y: PAD_TOP + innerH - (m.views / max) * innerH,
    m,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${PAD_TOP + innerH} L ${points[0].x.toFixed(1)} ${PAD_TOP + innerH} Z`;

  return (
    <div className="border-t border-line pt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height: 140 }}>
        <defs>
          <linearGradient id="perfFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* striped floor — alternating bands read faster than bare gridlines */}
        {[0, 1, 2, 3].map((i) => (
          <rect
            key={i}
            x={0}
            y={PAD_TOP + (innerH / 4) * i}
            width={W}
            height={innerH / 4}
            fill={i % 2 === 0 ? "var(--color-panel)" : "transparent"}
          />
        ))}
        <path d={areaPath} fill="url(#perfFill)" />
        <path d={linePath} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={p.m.views > 0 ? 3 : 0} fill="var(--color-accent)" />
            {p.m.views > 0 ? (
              <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize="10" fill="var(--color-ink-2)">
                {compact(p.m.views)}
              </text>
            ) : null}
            <text x={p.x} y={H - 4} textAnchor="middle" fontSize="10" fill="var(--color-ink-3)">
              {(() => {
                const [y, mo] = p.m.month.split("-").map(Number);
                return MONTH_LABEL.format(new Date(y, mo - 1, 1));
              })()}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/**
 * Performance, small.
 *
 * This is the whole of analytics that belongs on the Overview: how the month
 * is going, how the last 30 days went, and the one video worth opening.
 * Anything that needs a filter lives on /analytics and stays there.
 */
export function PerformancePanel({ data }: { data: Performance }) {
  const { monthToDate: mtd, last30, viewsTrend } = data;

  return (
    <section className="rounded-xl border border-line bg-card p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          Performance
        </h2>
        <Link href="/analytics" className="ml-auto text-xs text-ink-2 hover:text-ink">
          Analytics →
        </Link>
      </div>

      {data.awaitingMetrics ? (
        <p className="rounded-lg bg-panel px-3 py-2.5 text-xs leading-snug text-ink-3">
          {mtd.posts + last30.posts > 0
            ? "Posted, but Instagram hasn't returned numbers yet. They arrive once each post is linked to its media id."
            : "Nothing posted in the last 30 days."}
        </p>
      ) : (
        <div className="space-y-3">
          <div>
            <span className="mb-1.5 flex items-baseline gap-2 text-[10px] font-medium uppercase tracking-wider text-ink-2">
              Last 30 days
              {viewsTrend !== null ? (
                <span
                  className={`ml-auto normal-case tracking-normal ${
                    viewsTrend >= 0 ? "text-ok" : "text-warn"
                  }`}
                >
                  {viewsTrend >= 0 ? "▲" : "▼"} {Math.abs(viewsTrend * 100).toFixed(0)}% on the 30
                  before
                </span>
              ) : null}
            </span>
            <div className="grid grid-cols-3 gap-2">
              <Figure label="Posted" value={String(last30.posts)} />
              <Figure label="Views" value={compact(last30.views)} />
              <Figure label="Reach" value={compact(last30.reach)} />
            </div>
          </div>

          <MonthlyViewsLine monthly={data.monthly} />
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- runway -- */

function runwayTone(days: number | null): { colour: string; line: string } {
  if (days === null) return { colour: "var(--color-danger)", line: "Nothing is scheduled." };
  if (days <= 3) return { colour: "var(--color-danger)", line: "You'll run out this week." };
  if (days <= 10) return { colour: "var(--color-warn)", line: "Worth booking the next batch." };
  return { colour: "var(--color-ok)", line: "Comfortable." };
}

/**
 * How many days of scheduled posts are left, and what's behind them.
 *
 * The stage counts are the diagnosis, not decoration: a short runway with a
 * full idea shelf is a filming problem, and a short runway with an empty one
 * is a writing problem. Those are different mornings.
 */
export function RunwayPanel({ data }: { data: Runway }) {
  const tone = runwayTone(data.daysLeft);

  return (
    <section className="rounded-xl border border-line bg-card p-4">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
        Runway
      </h2>

      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums" style={{ color: tone.colour }}>
          {data.daysLeft === null ? "0" : data.daysLeft}
        </span>
        <span className="text-sm text-ink-2">
          day{data.daysLeft === 1 ? "" : "s"} of posts scheduled
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-3">
        {data.lastDate ? (
          <>
            Booked through{" "}
            {new Date(`${data.lastDate}T00:00:00`).toLocaleDateString(undefined, {
              day: "numeric",
              month: "long",
            })}
            {" · "}
            {data.scheduled} post{data.scheduled === 1 ? "" : "s"} ahead. {tone.line}
          </>
        ) : (
          <>
            {data.totalUnposted} video{data.totalUnposted === 1 ? "" : "s"} in the pipeline, none
            with a date on it. {tone.line}
          </>
        )}
      </p>

      {data.totalUnposted > 0 ? (
        <div className="mt-3 flex h-2 overflow-hidden rounded-full border-t-0">
          {data.depth.map((d, i) =>
            d.count > 0 ? (
              <div
                key={d.label}
                title={`${d.label}: ${d.count}`}
                style={{ width: `${(d.count / data.totalUnposted) * 100}%`, background: DEPTH_COLOR[i] }}
              />
            ) : null
          )}
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-5 gap-1.5 border-t border-line pt-3">
        {data.depth.map((d, i) => (
          <Link
            key={d.label}
            href={d.href}
            className="rounded-lg px-1.5 py-1.5 transition hover:bg-hover"
          >
            <span
              className="mb-0.5 flex items-center gap-1 text-base font-semibold tabular-nums"
              style={{ color: d.count > 0 ? DEPTH_COLOR[i] : undefined }}
            >
              {d.count}
            </span>
            <span className="block truncate text-[10px] text-ink-3">{d.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
