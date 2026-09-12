import { requireRole } from "@/lib/auth";
import { listActiveBoard, listEditors, listTaxonomyCustoms } from "@/app/actions";
import { VideoRow } from "@/components/pipeline/VideoRow";
import { StageMove } from "@/components/pipeline/StageMove";
import { StageBack } from "@/components/pipeline/StageBack";
import { CreateVideoButton } from "@/components/CreateVideoButton";
import { IconCheck } from "@/components/ui/icons";

/**
 * Scripts in progress. A video only leaves here for Ready to Edit, which is the
 * moment the editors first see it — so the "Send to editors" button is the
 * meaningful action on this page.
 */
export default async function ScriptingPage() {
  const viewer = await requireRole("owner", "admin");
  const [board, editors, customs] = await Promise.all([
    listActiveBoard(),
    listEditors(),
    listTaxonomyCustoms(),
  ]);

  const scripting = board.filter((v) => v.status === "scripting");
  // Written enough to hand over: a body, or at least one hook.
  const ready = scripting.filter((v) => v.script_body?.trim() || v.script_hooks?.length);
  const customsBy = {
    content_pillar: customs.filter((c) => c.kind === "content_pillar").map((c) => c.value),
    format: customs.filter((c) => c.kind === "format").map((c) => c.value),
    platform: customs.filter((c) => c.kind === "platform").map((c) => c.value),
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Scripting</h1>
          <p className="text-sm text-ink-2">
            {scripting.length} being written · {ready.length} ready to film
          </p>
        </div>
        <CreateVideoButton editors={editors} customs={customsBy} viewerId={viewer.id} />
      </div>

      <p className="rounded-lg border border-line bg-card px-3 py-2 text-xs text-ink-3">
        More than one hook in a script means hook variants are expected, and the video will route
        through Awaiting Variants after you approve it. One hook means it won&rsquo;t.
      </p>

      {scripting.length === 0 ? (
        <div className="rounded-xl border border-line bg-card px-4 py-12 text-center">
          <span className="text-ok">
            <IconCheck size={18} />
          </span>
          <p className="mt-2 text-sm text-ink-2">Nothing waiting to be written.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-app">
          {scripting.map((v) => (
            <VideoRow
              key={v.id}
              video={v}
              href={`/videos/${v.id}/script`}
              showStage={false}
              showEta={false}
              action={
                <span className="flex items-center gap-1">
                  <StageBack videoId={v.id} status={v.status} compact />
                  <StageMove videoId={v.id} to="ready_to_film" label="Ready to film" />
                </span>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
