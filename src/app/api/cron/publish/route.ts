import { runDuePublishJobs } from "@/lib/publish-runner";

// A single Reel can take a couple of minutes to be accepted by Instagram.
export const maxDuration = 300;

/**
 * Just the scheduled posts — nothing else.
 *
 * The main job (/api/cron) runs once a day, which is far too slow for "post
 * this at 3pm". Point a scheduler at THIS route every 5–10 minutes instead
 * (cron-job.org is free): it's cheap when nothing is due, and doesn't touch
 * the backup or the reports, so hitting it often is safe. Same credential as
 * the main job: `?key=$CRON_SECRET`, or Vercel's own signed header.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = process.env.CRON_SECRET;
  const authorized =
    !secret ||
    url.searchParams.get("key") === secret ||
    req.headers.get("authorization") === `Bearer ${secret}`;
  if (!authorized) return new Response("unauthorized", { status: 401 });

  const result = await runDuePublishJobs();
  return Response.json({ ok: true, ...result });
}
