import { runDuePublishJobs } from "@/lib/publish-runner";
import { cronAuthorised } from "@/lib/cron-auth";
import { syncPendingVersions } from "@/lib/stream-sync";
import { purgeOldDoneTasks } from "@/lib/task-purge";

// A single Reel can take a couple of minutes to be accepted by Instagram.
export const maxDuration = 300;

/**
 * The scheduled posts, plus finishing uploads that were still processing when
 * their page was closed — nothing else.
 *
 * The main job (/api/cron) runs once a day, which is far too slow for "post
 * this at 3pm". Point a scheduler at THIS route every 5–10 minutes instead
 * (cron-job.org is free): it's cheap when nothing is due, and doesn't touch
 * the backup or the reports, so hitting it often is safe. Same credential as
 * the main job: `?key=$CRON_SECRET`, or Vercel's own signed header.
 */
export async function GET(req: Request) {
  if (!cronAuthorised(req)) return new Response("unauthorized", { status: 401 });

  const result = await runDuePublishJobs();
  // Also finishes any upload whose page was closed before Cloudflare was done.
  const synced = await syncPendingVersions();
  await purgeOldDoneTasks();
  return Response.json({ ok: true, ...result, synced });
}
