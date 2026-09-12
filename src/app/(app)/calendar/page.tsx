import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { calendarData, listCadenceSlots } from "@/app/calendar-actions";
import { listTaxonomyCustoms } from "@/app/actions";
import { taxonomyOptions } from "@/lib/taxonomy";
import { CalendarBoard } from "@/components/calendar/CalendarBoard";
import { buildMonthGrid, shiftMonth } from "@/lib/calendar";

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const viewer = await requireUser();
  // The posting schedule is the client's concern. An editor works to the ETA
  // they gave, and their own board already carries those dates.
  if (viewer.role === "editor") redirect("/my-work");
  const sp = await searchParams;
  const now = new Date();
  const year = Number(first(sp.y) ?? now.getFullYear());
  const month = Number(first(sp.m) ?? now.getMonth());

  const grid = buildMonthGrid(year, month);
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);

  const [data, cadence, customs] = await Promise.all([
    calendarData(grid.firstISO, grid.lastISO),
    listCadenceSlots(),
    listTaxonomyCustoms(),
  ]);

  const clashes = data.scheduled.filter((v) => v.etaAfterPostDate).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{grid.label}</h1>
          <p className="text-sm text-ink-2">
            {data.scheduled.length} scheduled this month · {data.unscheduled.length} with no date
            {clashes > 0 ? (
              <span className="text-danger"> · {clashes} won&rsquo;t make the date</span>
            ) : null}
          </p>
        </div>
        <div className="flex gap-1 text-sm">
          <Link
            href={`/calendar?y=${prev.year}&m=${prev.month}`}
            className="rounded-md border border-line px-2.5 py-1.5 hover:bg-hover"
          >
            ←
          </Link>
          <Link href="/calendar" className="rounded-md border border-line px-2.5 py-1.5 hover:bg-hover">
            Today
          </Link>
          <Link
            href={`/calendar?y=${next.year}&m=${next.month}`}
            className="rounded-md border border-line px-2.5 py-1.5 hover:bg-hover"
          >
            →
          </Link>
        </div>
      </div>

      {/* Formats/platforms come from the presets *and* the client's own
          additions — passing only the customs left the cadence dropdowns
          empty on a workspace that hadn't added any of its own. */}
      <CalendarBoard
        year={year}
        month={month}
        data={data}
        cadence={cadence}
        formats={taxonomyOptions(
          "format",
          customs.filter((c) => c.kind === "format").map((c) => c.value)
        )}
        platforms={taxonomyOptions(
          "platform",
          customs.filter((c) => c.kind === "platform").map((c) => c.value)
        )}
        canEdit
      />
    </div>
  );
}
