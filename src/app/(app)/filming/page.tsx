import { requireRole } from "@/lib/auth";
import { listActiveBoard, listEditors, listTaxonomyCustoms } from "@/app/actions";
import { VideoRow } from "@/components/pipeline/VideoRow";
import { StageBack } from "@/components/pipeline/StageBack";
import { CreateVideoButton } from "@/components/CreateVideoButton";
import { IconCheck } from "@/components/ui/icons";

/**
 * Scripted, not yet shot. This is the answer to "what do I need to film?" —
 * the reason a shot list and a filming-day view aren't needed separately.
 */
export default async function FilmingPage() {
  const viewer = await requireRole("owner", "admin");
  const [board, editors, customs] = await Promise.all([
    listActiveBoard(),
    listEditors(),
    listTaxonomyCustoms(),
  ]);

  const toFilm = board.filter((v) => v.status === "ready_to_film");
  const customsBy = {
    content_pillar: customs.filter((c) => c.kind === "content_pillar").map((c) => c.value),
    format: customs.filter((c) => c.kind === "format").map((c) => c.value),
    platform: customs.filter((c) => c.kind === "platform").map((c) => c.value),
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Ready to Film</h1>
          <p className="text-sm text-ink-2">
            {toFilm.length} scripted and waiting to be shot. Film them, then send them to the
            editors.
          </p>
        </div>
        <CreateVideoButton editors={editors} customs={customsBy} viewerId={viewer.id} />
      </div>

      <p className="rounded-lg border border-line bg-card px-3 py-2 text-xs text-ink-3">
        Open a video for the teleprompter, footage, music, references and the editor&rsquo;s brief
        all in one place — then send it to the editors from there.
      </p>

      {toFilm.length === 0 ? (
        <div className="rounded-xl border border-line bg-card px-4 py-12 text-center">
          <span className="text-ok">
            <IconCheck size={18} />
          </span>
          <p className="mt-2 text-sm text-ink-2">Nothing waiting to be filmed.</p>
          <p className="mt-1 text-xs text-ink-3">
            Finish a script and move it here when it&rsquo;s ready to shoot.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-app">
          {toFilm.map((v) => (
            <VideoRow
              key={v.id}
              video={v}
              href={`/videos/${v.id}/film`}
              showStage={false}
              showEta={false}
              action={<StageBack videoId={v.id} status={v.status} compact />}
            />
          ))}
        </div>
      )}
    </div>
  );
}
