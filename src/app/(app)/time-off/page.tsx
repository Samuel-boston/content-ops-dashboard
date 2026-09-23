import { requireUser } from "@/lib/auth";
import { listTimeOff } from "@/app/pricing-actions";
import { TimeOffPanel } from "@/components/team/MonthActions";

/**
 * Your own time off — the same calendar the client sees on the Team page,
 * but set from the seat it belongs to. Editors, the copywriter and the VA all
 * mark their own days here; nobody has to declare availability, it's just so
 * the client can plan around it.
 */
export default async function TimeOffPage() {
  const viewer = await requireUser();
  const entries = await listTimeOff(viewer.id);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Time off</h1>
        <p className="text-sm text-ink-2">
          Click a day to start, click another to finish the range. Click a booked day to clear it.
        </p>
      </div>
      <section className="max-w-2xl">
        <TimeOffPanel editorId={viewer.id} entries={entries} canEdit />
      </section>
    </div>
  );
}
