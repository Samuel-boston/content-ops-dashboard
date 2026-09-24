/**
 * The maths behind "this one was an outlier". Pure numbers in, numbers out — no
 * database — so it can be tested on its own.
 *
 * A post is an outlier when its views are far from what this account usually
 * gets. "Usually" is the median (a couple of viral posts don't drag it up the
 * way an average would), and "far" is measured against the spread of the same
 * posts (median absolute deviation), with a plain multiple of the median as the
 * floor so a very consistent account doesn't flag tiny wobbles.
 */

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface OutlierResult {
  /** views / typical views, e.g. 4.2 means 4.2x the usual. */
  multiple: number;
  direction: "high" | "low";
  /** How many spreads from the median (robust z-score). */
  score: number;
}

export interface Baseline {
  median: number;
  mad: number;
  n: number;
}

/** Fewer than this many posts and "typical" means nothing, so nothing is flagged. */
export const MIN_POSTS_FOR_OUTLIERS = 5;

export function baselineOf(views: number[]): Baseline {
  const m = median(views);
  return { median: m, mad: median(views.map((v) => Math.abs(v - m))), n: views.length };
}

/**
 * Is this post an outlier against the baseline? High: at least 2x typical and
 * either 2.5 spreads above it, or (when the account is very consistent) 3x.
 * Low: at most a third of typical and 2.5 spreads below.
 */
export function classify(views: number, base: Baseline): OutlierResult | null {
  if (base.n < MIN_POSTS_FOR_OUTLIERS || base.median <= 0) return null;
  const multiple = views / base.median;
  const spread = 1.4826 * base.mad;
  const score = spread > 0 ? (views - base.median) / spread : multiple >= 1 ? 99 : -99;
  if (multiple >= 2 && (score >= 2.5 || multiple >= 3)) return { multiple, direction: "high", score };
  if (multiple <= 1 / 3 && score <= -2.5) return { multiple, direction: "low", score };
  return null;
}

export const fmtViews = (n: number | null | undefined): string => {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(n));
};
