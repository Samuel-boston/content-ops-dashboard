import { requireRole } from "@/lib/auth";
import { listParked } from "@/app/pipeline-actions";
import { VideoRow } from "@/components/pipeline/VideoRow";
import { ParkButton } from "@/components/pipeline/ParkButton";
import { IconClock } from "@/components/ui/icons";
import { dayMonth } from "@/lib/format";

/**
 * Everything shelved for later.
 *
 * The point of this page is what it takes *out* of the rest of the dashboard.
 * An idea you like but aren't making this quarter used to have to sit in a
 * real stage, padding every count and making the pipeline look busier than it
 * was. Here it keeps its stage and its script, and counts for nothing until
 * you pick it back up.
 */
export default async function ParkedPage() {
  await requireRole("owner", "admin");
  const parked = await listParked();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Later</h1>
        <p className="text-sm text-ink-2">
          {parked.length === 0
            ? "Nothing shelved."
            : `${parked.length} shelved — out of every board, queue and count until you pick ${
                parked.length === 1 ? "it" : "them"
              } back up.`}
        </p>
      </div>

      {parked.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-strong px-4 py-12 text-center">
          <span className="text-ink-3">
            <IconClock size={18} />
          </span>
          <p className="mt-2 text-sm text-ink-2">Nothing waiting on the shelf.</p>
          <p className="mt-1 text-xs text-ink-3">
            Anything you&rsquo;re not making yet — an idea for next quarter, a video blocked on
            something — can be parked here from its own page, and comes back exactly where it
            left off.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-app">
          {parked.map((v) => (
            <VideoRow
              key={v.id}
              video={v}
              href={`/videos/${v.id}`}
              showEta={false}
              action={
                <span className="flex items-center gap-2">
                  {v.parked_reason ? (
                    <span className="hidden max-w-[220px] truncate text-[11px] text-ink-3 sm:inline">
                      {v.parked_reason}
                    </span>
                  ) : null}
                  {v.parked_at ? (
                    <span className="hidden text-[10px] text-ink-3 md:inline">
                      since {dayMonth(v.parked_at)}
                    </span>
                  ) : null}
                  <ParkButton videoId={v.id} parked />
                </span>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
