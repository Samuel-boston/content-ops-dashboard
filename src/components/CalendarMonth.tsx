import Link from "next/link";
import { calendarVideos } from "@/app/actions";
import { buildMonthGrid, iso } from "@/lib/calendar";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export async function CalendarMonth({
  year,
  month,
  compact = false,
}: {
  year: number;
  month: number;
  compact?: boolean;
}) {
  const grid = buildMonthGrid(year, month);
  const videos = await calendarVideos(grid.firstISO, grid.lastISO);

  const byDay = new Map<string, typeof videos>();
  for (const v of videos) {
    if (!v.post_date) continue;
    const key = v.post_date.slice(0, 10);
    byDay.set(key, [...(byDay.get(key) ?? []), v]);
  }

  const todayISO = iso(new Date());

  return (
    <div className="rounded-xl border border-line bg-app overflow-hidden">
      <div className="grid grid-cols-7 border-b border-line">
        {DOW.map((d) => (
          <div key={d} className="px-2 py-1.5 text-[11px] font-medium text-ink-3">
            {compact ? d[0] : d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {grid.weeks.flat().map((date, i) => {
          const key = date ? iso(date) : `empty-${i}`;
          const dayVideos = date ? byDay.get(iso(date)) ?? [] : [];
          return (
            <div
              key={key}
              className={`border-b border-r border-line p-1.5 ${
                compact ? "min-h-14" : "min-h-[104px]"
              } ${date && iso(date) === todayISO ? "bg-card/60" : ""}`}
            >
              {date ? (
                <>
                  <div className="text-[11px] text-ink-3">{date.getDate()}</div>
                  <div className="mt-1 space-y-0.5">
                    {dayVideos.slice(0, compact ? 2 : 4).map((v) => (
                      <Link
                        key={v.id}
                        href={`/videos/${v.id}`}
                        title={v.title}
                        className={`block truncate rounded px-1 py-0.5 text-[11px] ${
                          v.status === "posted"
                            ? "bg-ok/10 text-ok"
                            : "bg-raised text-ink-2"
                        }`}
                      >
                        {v.title}
                      </Link>
                    ))}
                    {dayVideos.length > (compact ? 2 : 4) ? (
                      <span className="text-[10px] text-ink-3">
                        +{dayVideos.length - (compact ? 2 : 4)} more
                      </span>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
