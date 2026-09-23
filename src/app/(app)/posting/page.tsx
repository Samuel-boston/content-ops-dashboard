import { requireRole } from "@/lib/auth";
import { listPostingWork } from "@/app/posting-actions";
import { PostingQueue } from "@/components/posting/PostingQueue";
import { listVaTasks } from "@/app/task-actions";
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
  const [{ trials, jobs }, tasks] = await Promise.all([listPostingWork(), listVaTasks()]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Posting</h1>
        <p className="text-sm text-ink-2">
          {trials.filter((t) => t.status === "planned").length} to post ·{" "}
          {trials.filter((t) => t.status === "posted" && !t.hasMetrics).length} awaiting numbers
        </p>
      </div>
      <PostingQueue trials={trials} jobs={jobs} viewerRole={viewer.role} />

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
