// Renders the digest with a fake database. NODE_OPTIONS=--conditions=react-server npx tsx scripts/test-digest-performance.mts
import assert from "node:assert/strict";
import { buildPerformance } from "../src/lib/performance.ts";
import { digestHtml, digestText, digestTelegram, digestSlack, type DigestData } from "../src/lib/digest.ts";

const now = new Date("2026-09-28T09:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 864e5).toISOString();

// A tiny stand-in for the Supabase query builder: every chain ends in the same rows.
function fake(tables: Record<string, unknown[]>) {
  return {
    from(name: string) {
      const q: any = { then: (res: (v: unknown) => void) => res({ data: tables[name] ?? [], error: null }) };
      for (const m of ["select", "in", "not", "eq", "is", "order", "neq"]) q[m] = () => q;
      return q;
    },
  } as any;
}

const videos = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ id: `v${i}`, title: `Video ${i}`, status: "posted", posted_at: daysAgo(i * 3), script_hooks: [`Hook line ${i}`] })),
  { id: "vx", title: "The viral one", status: "posted", posted_at: daysAgo(2), script_hooks: ["Nobody tells you this about burnout"] },
  { id: "vy", title: "The flop", status: "posted", posted_at: daysAgo(5), script_hooks: ["A flat opener"] },
];
const metrics = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ video_id: `v${i}`, views: 1000 + i * 20, likes: 50, comments: 3, shares: 2, saves: 4, permalink: `https://instagram.com/p/${i}` })),
  { video_id: "vx", views: 9800, likes: 700, comments: 40, shares: 90, saves: 200, permalink: "https://instagram.com/p/viral" },
  { video_id: "vy", views: 90, likes: 2, comments: 0, shares: 0, saves: 0, permalink: null },
];
const perf = await buildPerformance(fake({ video_metrics: metrics, trial_posts: [], videos }), now);

assert.equal(perf.hasData, true);
assert.ok(perf.week.posts >= 2 && perf.month.posts >= 8);
assert.ok(perf.typicalViews && perf.typicalViews > 900 && perf.typicalViews < 1300);
assert.equal(perf.topWeek[0].title, "The viral one");
const hi = perf.outliers.find((o) => o.title === "The viral one")!;
assert.equal(hi.direction, "high"); assert.ok(hi.multiple > 6); assert.equal(hi.thisWeek, true);
const lo = perf.outliers.find((o) => o.title === "The flop")!;
assert.equal(lo.direction, "low");
assert.equal(perf.outliers[0].title, "The viral one", "the loudest this-week outlier leads");

// nothing to say when there's no history
const empty = await buildPerformance(fake({ video_metrics: [], trial_posts: [], videos: [] }), now);
assert.equal(empty.hasData, false); assert.equal(empty.outliers.length, 0);

const research = {
  prompt: "Find viral stuff",
  chatgptUrl: "https://chatgpt.com/?q=Find%20viral%20stuff",
  claudeUrl: "https://claude.ai/new?q=Find%20viral%20stuff",
  finds: [{ topic: "Airport anxiety hack", hook: "Do this before you board", views: 640000, link: "https://instagram.com/reel/f1", creator: "@calm", platform: "instagram" }],
};
const d: DigestData = { weekOf: "28 Sep", posted: [], postingNext: [], waitingOnYou: [], withEditors: [], runwayDays: 12, ideas: 4, scripts: 2, toFilm: 1, performance: perf, research };
const html = digestHtml(d, "https://x.vercel.app", "Adam");
assert.match(html, /Performance/); assert.match(html, /Standouts/); assert.match(html, /The viral one/);
assert.match(html, /Best of the last 30 days/); assert.match(html, /top-posts/);
assert.match(html, /Nobody tells you this about burnout/);
const text = digestText(d, "https://x.vercel.app", "Adam");
assert.match(text, /PERFORMANCE/); assert.match(text, /Standouts:/); assert.match(text, /The viral one — 9\.8K views/);
assert.match(digestTelegram(d), /Performance/);
assert.match(digestSlack(d), /🔥/);
assert.match(html, /Open in ChatGPT/); assert.match(html, /Open in Claude/); assert.match(html, /New viral finds this week/); assert.match(html, /Airport anxiety hack/);
assert.match(text, /ChatGPT: https:\/\/chatgpt\.com/); assert.match(digestSlack(d), /Open in ChatGPT/);
assert.doesNotMatch(digestHtml({ ...d, research: null }, "https://x", "Adam"), /Open in ChatGPT/);
// a digest with no numbers still renders and says so
const none = digestHtml({ ...d, performance: empty }, "https://x", "Adam");
assert.match(none, /No numbers yet/);
assert.doesNotMatch(digestHtml({ ...d, performance: null }, "https://x", "Adam"), /Standouts/);
console.log("digest performance: all checks passed");
