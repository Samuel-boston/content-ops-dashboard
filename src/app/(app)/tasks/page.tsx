import { requireRole } from "@/lib/auth";
import { listVaTasks } from "@/app/task-actions";
import { VaTaskBoard } from "@/components/tasks/VaTaskBoard";

/**
 * The VA's "Other" board — everything that isn't posting. Managers land here
 * as "VA Tasks" to write and reorder the list; the VA sees the same board and
 * can tick things off.
 */
export default async function TasksPage() {
  const viewer = await requireRole("va", "owner", "admin");
  const tasks = await listVaTasks();
  const canManage = viewer.role !== "va";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">{canManage ? "VA Tasks" : "Other"}</h1>
        <p className="text-sm text-ink-2">
          {tasks.filter((t) => t.status === "todo").length} open
          {canManage ? " · tasks for the VA that aren’t posting" : " · click a task for the details"}
        </p>
      </div>
      <VaTaskBoard tasks={tasks} canManage={canManage} />
    </div>
  );
}
