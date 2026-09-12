/**
 * A different line depending on the hour, picked at random from a small pool
 * per time-of-day so it doesn't say the exact same thing every morning.
 * Server-rendered only (like the rest of this page) — computed once per
 * request, so there's nothing for the client to disagree with on hydration.
 */
const BUCKETS: { until: number; lines: string[] }[] = [
  { until: 5, lines: ["Burning the midnight oil", "Still up", "Night shift"] },
  { until: 9, lines: ["Morning coffee", "Rise and shine", "Good morning", "Early start"] },
  { until: 12, lines: ["Good morning", "Late morning"] },
  { until: 17, lines: ["Good afternoon", "Afternoon"] },
  { until: 21, lines: ["Good evening", "Evening"] },
  { until: 24, lines: ["Night shift", "Winding down", "Good evening"] },
];

export function timeGreeting(now = new Date()): string {
  const h = now.getHours();
  const bucket = BUCKETS.find((b) => h < b.until) ?? BUCKETS[BUCKETS.length - 1];
  return bucket.lines[Math.floor(Math.random() * bucket.lines.length)];
}
