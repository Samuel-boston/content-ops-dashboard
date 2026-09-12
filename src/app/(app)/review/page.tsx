import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { clientActions } from "@/app/team-actions";
import { VideoList } from "@/components/pipeline/VideoRow";
import { IconCheck } from "@/components/ui/icons";
import { STATUS_COLOR, STATUS_LABELS } from "@/lib/types";

/**
 * Everything waiting on the client, in the order it should be dealt with:
 * new cuts first, then variant checks, then things cleared to go out.
 */
export default async function ReviewPage() {
  await requireRole("owner", "admin");
  const actions = await clientActions();

  const sections = [
    {
      id: "review",
      status: "in_review" as const,
      videos: actions.toReview,
      blurb: "New cuts waiting on your notes. Open one to comment on the timeline.",
      empty: "Nothing waiting on your review.",
    },
    {
      id: "final",
      status: "final_review" as const,
      videos: actions.toFinalReview,
      blurb: "Hook variants are in. Last look before these are cleared to post.",
      empty: "No variants waiting on a final check.",
    },
    {
      id: "post",
      status: "ready_to_post" as const,
      videos: actions.readyToPost,
      blurb: "Approved and done. Schedule or post them from inside the video.",
      empty: "Nothing sitting ready to post.",
    },
  ];

  const total = sections.reduce((n, s) => n + s.videos.length, 0);

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-xl font-semibold">Review</h1>
        <p className="text-sm text-ink-2">
          {total === 0
            ? "Nothing needs you here right now."
            : `${total} video${total === 1 ? "" : "s"} waiting on you.`}
        </p>
      </div>

      {total === 0 ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-ok/30 bg-ok/5 px-4 py-4">
          <span className="text-ok">
            <IconCheck size={18} />
          </span>
          <p className="text-sm text-ink-2">
            All clear — everything in flight is with the editors.{" "}
            <Link href="/board" className="text-accent-hi hover:underline">
              See the board
            </Link>
            .
          </p>
        </div>
      ) : null}

      {sections.map((s) => (
        <section key={s.id} id={s.id} className="scroll-mt-20">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: STATUS_COLOR[s.status] }}
            />
            <h2 className="font-semibold">{STATUS_LABELS[s.status]}</h2>
            <span className="text-sm text-ink-3">{s.videos.length}</span>
          </div>
          <p className="mb-2.5 text-xs text-ink-3">{s.blurb}</p>
          <VideoList
            videos={s.videos}
            showStage={false}
            hrefFor={(v) => `/videos/${v.id}`}
            empty={s.empty}
          />
        </section>
      ))}
    </div>
  );
}
