import { requireRole } from "@/lib/auth";
import { listActiveBoard } from "@/app/actions";
import { VideoRow } from "@/components/pipeline/VideoRow";
import { StageMove } from "@/components/pipeline/StageMove";
import { StageBack } from "@/components/pipeline/StageBack";
import { ApproveCarouselButton } from "@/components/pipeline/ApproveCarouselButton";
import { IconCheck } from "@/components/ui/icons";
import { isCarouselFormat } from "@/lib/taxonomy";

/**
 * The script sign-off queue. A copywriter submits here from Scripting; the
 * client reads the script and either approves it for filming or sends it
 * back. This page is the copywriter's "waiting on you" list and the client's
 * "waiting on me" list — same rows, opposite verbs, which is why approval
 * renders only for managers (the DB guard enforces the same split).
 */
export default async function ScriptReviewPage() {
  const viewer = await requireRole("owner", "admin", "copywriter");
  const board = await listActiveBoard();

  const waiting = board.filter((v) => v.status === "script_review");
  // A carousel's approval goes straight to Ready to Post (see the Carousels
  // board), not this "headed to filming" list — only non-carousel work
  // reaches Ready to Film at all.
  const approved = board.filter((v) => v.status === "ready_to_film");
  const isManager = viewer.role === "owner" || viewer.role === "admin";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Script Review</h1>
        <p className="text-sm text-ink-2">
          {waiting.length} waiting on {isManager ? "you" : "the client"} · {approved.length} approved
          and headed to filming
        </p>
      </div>

      {waiting.length === 0 ? (
        <div className="rounded-xl border border-line bg-card px-4 py-12 text-center">
          <span className="text-ok">
            <IconCheck size={18} />
          </span>
          <p className="mt-2 text-sm text-ink-2">No scripts waiting for sign-off.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-app">
          {waiting.map((v) => (
            <VideoRow
              key={v.id}
              video={v}
              href={`/videos/${v.id}/script`}
              showStage={false}
              showEta={false}
              action={
                <span className="flex items-center gap-1">
                  <StageBack videoId={v.id} status={v.status} compact />
                  {isManager ? (
                    isCarouselFormat(v.formats) ? (
                      <ApproveCarouselButton videoId={v.id} />
                    ) : (
                      <StageMove videoId={v.id} to="ready_to_film" label="Approve — ready to film" />
                    )
                  ) : null}
                </span>
              }
            />
          ))}
        </div>
      )}

      {approved.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink-2">Approved — to record</h2>
          <div className="overflow-hidden rounded-xl border border-line bg-app">
            {approved.map((v) => (
              <VideoRow
                key={v.id}
                video={v}
                href={`/videos/${v.id}/${isManager ? "film" : "script"}`}
                showStage={false}
                showEta={false}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
