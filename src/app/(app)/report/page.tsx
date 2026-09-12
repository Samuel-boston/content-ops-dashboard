import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { listActiveBoard, stageCounts } from "@/app/actions";
import { clientActions, teamSnapshots } from "@/app/team-actions";
import { computePriorities } from "@/lib/priorities";
import { annotateOverdue } from "@/lib/priorities";
import { ACTIVE_STATUSES, STATUS_COLOR, STATUS_LABELS } from "@/lib/types";
import { Avatar } from "@/components/ui/Avatar";
import { dayMonth, displayName } from "@/lib/format";

/**
 * The Monday summary as a page rather than a message — readable on a phone,
 * and something the client can forward. Same numbers the Telegram report uses.
 */
export default async function ReportPage() {
  await requireRole("owner", "admin");
  const [counts, board, actions, team] = await Promise.all([
    stageCounts(),
    listActiveBoard(),
    clientActions(),
    teamSnapshots(),
  ]);

  const priorities = computePriorities(board);
  const overdue = annotateOverdue(board).filter((v) => v.overdue);
  const week = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="mx-auto max-w-3xl space-y-7">
      <div>
        <p className="text-[11px] uppercase tracking-wider text-ink-3">Weekly report</p>
        <h1 className="text-xl font-semibold">Week of {week}</h1>
      </div>

      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          Where everything is
        </h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {ACTIVE_STATUSES.map((s) => (
            <div key={s} className="rounded-xl border border-line bg-card px-3 py-2.5">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[s] }} />
                <span className="truncate text-[10px] text-ink-3">{STATUS_LABELS[s]}</span>
              </span>
              <span className="mt-0.5 block text-lg font-semibold tabular-nums">
                {counts[s] ?? 0}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          Priority this week
        </h2>
        <div className="space-y-2">
          {priorities.map((p) => (
            <Link
              key={p.key}
              href={p.href}
              className="block rounded-xl border border-line bg-card px-4 py-3 hover:border-line-strong"
            >
              <p className="text-sm font-medium">{p.label}</p>
              {p.examples.length ? (
                <p className="mt-0.5 text-xs text-ink-3">{p.examples.join(" · ")}</p>
              ) : null}
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          Waiting on you
        </h2>
        <div className="rounded-xl border border-line bg-card px-4 py-3 text-sm text-ink-2">
          {actions.toReview.length} to review · {actions.toFinalReview.length} final checks ·{" "}
          {actions.readyToPost.length} ready to post · {actions.toFilm.length} to film
          {actions.poolRunningDry ? (
            <span className="text-warn"> · the editors will run dry, time to film</span>
          ) : null}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          The team
        </h2>
        <div className="space-y-2">
          {team.map((s) => (
            <div key={s.editor.id} className="rounded-xl border border-line bg-card px-4 py-3">
              <div className="flex items-center gap-2">
                <Avatar person={s.editor} size="md" />
                <span className="text-sm font-medium">{displayName(s.editor)}</span>
                <span className="ml-auto text-xs text-ink-3">
                  {s.inFlight.length} in flight · {s.postedThisMonth} posted this month
                </span>
              </div>
              {s.active.length ? (
                <p className="mt-1.5 text-xs text-ink-3">
                  Editing: {s.active.map((v) => v.title).join(" · ")}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {overdue.length ? (
        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Past their ETA
          </h2>
          <div className="overflow-hidden rounded-xl border border-danger/30">
            {overdue.map((v) => (
              <Link
                key={v.id}
                href={`/videos/${v.id}`}
                className="flex items-center gap-3 border-b border-line bg-card px-4 py-2.5 last:border-0"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{v.title}</span>
                <span className="text-xs text-danger">was due {dayMonth(v.eta_at)}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
