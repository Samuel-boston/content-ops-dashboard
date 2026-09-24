// npx tsx scripts/test-perf.mts
import assert from "node:assert/strict";
import { median, baselineOf, classify, fmtViews, MIN_POSTS_FOR_OUTLIERS } from "../src/lib/perf-stats.ts";

assert.equal(median([]), 0);
assert.equal(median([3, 1, 2]), 2);
assert.equal(median([4, 1, 2, 3]), 2.5);

// a normal week of posts, then one that popped and one that flopped
const usual = [900, 1100, 1000, 1200, 950, 1050, 1000, 980, 1120, 1010];
const base = baselineOf(usual);
assert.ok(base.median > 900 && base.median < 1100);
const hi = classify(6200, base)!;
assert.equal(hi.direction, "high"); assert.ok(hi.multiple > 5);
const lo = classify(120, base)!;
assert.equal(lo.direction, "low");
assert.equal(classify(1300, base), null, "a good week is not an outlier");
assert.equal(classify(2100, base)?.direction, "high", "2x an unusually steady account counts");

// too little history: never claim an outlier
assert.equal(classify(99999, baselineOf([100, 120, 90])), null);
assert.equal(MIN_POSTS_FOR_OUTLIERS, 5);
// zero-median guard
assert.equal(classify(500, baselineOf([0, 0, 0, 0, 0, 0])), null);
// a wildly varied account: 2x is normal noise, not an outlier
const noisy = baselineOf([100, 5000, 300, 9000, 200, 4000, 800, 60]);
assert.equal(classify(1500, noisy), null);

assert.equal(fmtViews(950), "950");
assert.equal(fmtViews(12_400), "12K");
assert.equal(fmtViews(1_240_000), "1.2M");
assert.equal(fmtViews(null), "—");
console.log("perf stats: all checks passed");
