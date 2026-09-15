import { requireRole } from "@/lib/auth";
import { listActiveBoard, listEditors, listTaxonomyCustoms } from "@/app/actions";
import { VideoRow } from "@/components/pipeline/VideoRow";
import { StageMove } from "@/components/pipeline/StageMove";
import { staleIds } from "@/lib/priorities";
import { CreateVideoButton } from "@/components/CreateVideoButton";
import { IdeaGeneratorButton } from "@/components/script/IdeaGeneratorButton";
import { IdeaVoiceCapture } from "@/components/script/IdeaVoiceCapture";

/**
 * The client's idea shelf. Private — editors can't see this stage at all, and
 * that's enforced by RLS rather than by hiding the nav link.
 */
export default async function IdeationPage() {
  const viewer = await requireRole("owner", "admin", "copywriter");
  const [board, editors, customs] = await Promise.all([
    listActiveBoard(),
    listEditors(),
    listTaxonomyCustoms(),
  ]);

  const ideas = board.filter((v) => v.status === "ideation");
  // An idea that's sat untouched for a month is either worth writing or worth
  // deleting, and both are better than it quietly aging on the shelf. Flagged
  // once, in place — deliberately not a notification.
  const STALE_DAYS = 30;
  const staleIdSet = staleIds(ideas, STALE_DAYS);
  const customsBy = {
    content_pillar: customs.filter((c) => c.kind === "content_pillar").map((c) => c.value),
    format: customs.filter((c) => c.kind === "format").map((c) => c.value),
    platform: customs.filter((c) => c.kind === "platform").map((c) => c.value),
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Ideation</h1>
          <p className="text-sm text-ink-2">
            Rough ideas, only visible to you. Move one to Scripting when it&rsquo;s worth writing.
            {staleIdSet.size > 0 ? (
              <span className="text-warn">
                {" "}
                {staleIdSet.size} {staleIdSet.size === 1 ? "has" : "have"} been sitting over a month.
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <IdeaVoiceCapture viewerId={viewer.id} />
          <IdeaGeneratorButton />
          <CreateVideoButton editors={editors} customs={customsBy} viewerId={viewer.id} />
        </div>
      </div>

      {ideas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-strong px-4 py-12 text-center">
          <p className="text-sm text-ink-2">No ideas parked yet.</p>
          <p className="mt-1 text-xs text-ink-3">
            Anything you add here stays private until you send it to the editors.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-app">
          {ideas.map((v) => (
            <VideoRow
              key={v.id}
              video={v}
              href={`/videos/${v.id}/idea`}
              showStage={false}
              showEta={false}
              showScriptBadge={false}
              action={
                <span className="flex items-center gap-2">
                  {staleIdSet.has(v.id) ? (
                    <span
                      title="Untouched for over a month — write it or drop it"
                      className="shrink-0 rounded-md bg-warn/10 px-1.5 py-1 text-[10px] text-warn"
                    >
                      going stale
                    </span>
                  ) : null}
                  <StageMove
                    videoId={v.id}
                    to="scripting"
                    label="Script it"
                    goTo={`/videos/${v.id}/script`}
                  />
                </span>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
