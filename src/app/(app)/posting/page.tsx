import { requireRole } from "@/lib/auth";
import { listPostedVideos, listPostingWork } from "@/app/posting-actions";
import { PostingBoard } from "@/components/posting/PostingBoard";
import { listVaTasks } from "@/app/task-actions";
import { getClientName } from "@/lib/workspace";
import { VaTaskBoard } from "@/components/tasks/VaTaskBoard";

/**
 * The posting desk — the VA's whole dashboard, and the only page their seat
 * can open. Trial reels can't be posted or read by Instagram's API, so this
 * page is built around the manual loop: download the cut, post it as a trial
 * from the app, paste the permalink back, and later type in the numbers from
 * the app's insights screen. The automatic publish queue shows underneath so
 * nothing gets posted twice.
 */
export default async function PostingPage() {
  const viewer = await requireRole("va", "owner", "admin");
  const [{ trials, jobs, instagramConnected, publerConnected, channels }, archive, tasks, clientName] = await Promise.all([
    listPostingWork(),
    listPostedVideos(),
    listVaTasks(),
    getClientName(),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Posting</h1>
        <p className="text-sm text-ink-2">
          {new Set(trials.filter((t) => t.videoStatus === "with_va").map((t) => t.videoId)).size} to post ·{" "}
          {archive.filter((r) => r.trialsLive > 0 && !r.best).length} posted videos waiting for trial numbers
        </p>
      </div>
      <PostingBoard
        trials={trials}
        jobs={jobs}
        archive={archive}
        instagramConnected={instagramConnected}
        publerConnected={publerConnected}
        channels={channels}
        clientName={clientName}
      />

      {/* Everything that isn't posting — right under it, so it can't be missed. */}
      <section className="space-y-3 border-t border-line pt-5">
        <div>
          <h2 className="text-base font-semibold">Other tasks</h2>
          <p className="text-sm text-ink-2">
            {tasks.filter((t) => t.status === "todo").length} open · click a task for the details
          </p>
        </div>
        <VaTaskBoard tasks={tasks} canManage={viewer.role !== "va"} />
      </section>
    </div>
  );
}
