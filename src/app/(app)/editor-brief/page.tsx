import { requireRole } from "@/lib/auth";
import { listActiveBoard, listEditors, listTaxonomyCustoms } from "@/app/actions";
import { VideoRow } from "@/components/pipeline/VideoRow";
import { StageBack } from "@/components/pipeline/StageBack";
import { isCarouselFormat } from "@/lib/taxonomy";
import { CreateVideoButton } from "@/components/CreateVideoButton";
import { IconCheck } from "@/components/ui/icons";

/**
 * Filmed, not yet handed off. The assembly step: brief, screen recording,
 * references, track and priority all get finished here before "Send to
 * editors" — the window the client described that a single "Ready to Film"
 * stage couldn't hold on its own.
 */
export default async function EditorBriefListPage() {
  const viewer = await requireRole("owner", "admin");
  const [board, editors, customs] = await Promise.all([
    listActiveBoard(),
    listEditors(),
    listTaxonomyCustoms(),
  ]);

  const inBrief = board.filter((v) => v.status === "editor_brief");
  const customsBy = {
    content_pillar: customs.filter((c) => c.kind === "content_pillar").map((c) => c.value),
    format: customs.filter((c) => c.kind === "format").map((c) => c.value),
    platform: customs.filter((c) => c.kind === "platform").map((c) => c.value),
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Editor Brief</h1>
          <p className="text-sm text-ink-2">
            {inBrief.length} filmed and being packaged for the editors.
          </p>
        </div>
        <CreateVideoButton editors={editors} customs={customsBy} viewerId={viewer.id} />
      </div>

      <p className="rounded-lg border border-line bg-card px-3 py-2 text-xs text-ink-3">
        Open a video for the brief, a screen recording, references, the track and priority — then
        send it to the editors from there.
      </p>

      {inBrief.length === 0 ? (
        <div className="rounded-xl border border-line bg-card px-4 py-12 text-center">
          <span className="text-ok">
            <IconCheck size={18} />
          </span>
          <p className="mt-2 text-sm text-ink-2">Nothing being packaged right now.</p>
          <p className="mt-1 text-xs text-ink-3">
            Finish filming and move it here when it&rsquo;s ready to brief the editors.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-app">
          {inBrief.map((v) => (
            <VideoRow
              key={v.id}
              video={v}
              href={`/videos/${v.id}/editor-brief`}
              showStage={false}
              showEta={false}
              action={
                <StageBack
                  videoId={v.id}
                  status={v.status}
                  compact
                  carousel={isCarouselFormat(v.formats)}
                />
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
