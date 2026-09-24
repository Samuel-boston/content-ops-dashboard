import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { editorBoard } from "@/app/editor-actions";
import { listMyQueue } from "@/app/actions";
import { mainCutStatusByVideoIds } from "@/app/engine-actions";
import { currentMonthKey, annotateOverdue } from "@/lib/priorities";
import { buildTaskGroups } from "@/lib/tasks";
import { TaskBoard } from "@/components/editor/TaskBoard";
import { MonthPanel } from "@/components/editor/MonthPanel";
import { WhatsNew } from "@/components/overview/WhatsNew";
import { markOverviewSeenAction, whatsNew } from "@/app/overview-actions";
import { IconLayers } from "@/components/ui/icons";
import { money } from "@/lib/format";
import { timeGreeting } from "@/lib/greeting";
import { getClientName } from "@/lib/workspace";

/**
 * The editor's home.
 *
 * Two things, in this order: what to do next, then the months. The task
 * board answers "what do I need to do" grouped by task type — revisions,
 * first cuts owed, hook variants aging, work already in progress — so
 * nobody has to open a month and read stage badges to find out. The months
 * further down are reference and billing: a month is the unit an editor is
 * paid in, so each one carries its own total, its own payment link, and
 * every video assigned in it whatever stage that video reached.
 */
export default async function MyWorkPage() {
  const viewer = await requireUser();
  if (viewer.role !== "editor") redirect("/");

  const [board, { pool }, news, clientName] = await Promise.all([
    editorBoard(),
    listMyQueue(),
    whatsNew(),
    getClientName(),
  ]);

  // Same watermark the client's Overview uses, moved after the read so this
  // render still shows what it found. `video_activity` is RLS-scoped per video,
  // so an editor only ever sees movement on their own work.
  await markOverviewSeenAction();

  // Overdue is computed here, not in render: `Date.now()` during render drifts
  // between server and client and trips hydration.
  const annotated = annotateOverdue(board.active);
  const overdueIds = new Set(annotated.filter((v) => v.overdue).map((v) => v.id));

  // Only "needs a first cut" vs "still editing" needs the cuts table — every
  // other group is decided by status alone.
  const inProgressIds = board.active.filter((v) => v.status === "in_progress").map((v) => v.id);
  const hasCut = await mainCutStatusByVideoIds(inProgressIds);
  const taskGroups = buildTaskGroups(board.active, hasCut);

  const thisMonthKey = currentMonthKey();
  const thisMonth = board.months.find((m) => m.month === thisMonthKey);
  const unpaid = board.months.filter((m) => !m.paid).reduce((n, m) => n + m.totalCents, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {timeGreeting()}{viewer.full_name?.split(" ")[0] ? `, ${viewer.full_name.split(" ")[0]}` : ""}
          </h1>
          <p className="text-sm text-ink-2">
            {board.active.length === 0
              ? "Nothing on your plate — take something from the Editing Bay."
              : `${board.active.length} on your plate`}
            {board.hasRates ? (
              <>
                {" · "}
                <span className="text-ok">
                  {money(thisMonth?.totalCents ?? 0, board.currency, { maximumFractionDigits: 2 })}
                </span>{" "}
                this month
                {unpaid > (thisMonth?.totalCents ?? 0) ? (
                  <span className="text-ink-3">
                    {" · "}
                    {money(unpaid, board.currency, { maximumFractionDigits: 2 })} unpaid in total
                  </span>
                ) : null}
              </>
            ) : null}
          </p>
        </div>
        <Link
          href="/editing-bay"
          className="flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink-2 transition hover:border-accent hover:text-ink"
        >
          <IconLayers size={14} />
          Editing Bay
          <span className="rounded-md bg-raised px-1.5 py-0.5 text-[11px] tabular-nums">
            {pool.length}
          </span>
        </Link>
      </div>

      {/* 1 — what to do next, grouped by task type */}
      <section>
        <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          Your board
        </h2>
        <TaskBoard groups={taskGroups} clientName={clientName} />
      </section>

      {/* 2 — what moved while they were away */}
      {news.groups.length > 0 ? <WhatsNew data={news} /> : null}

      {!board.hasRates ? (
        <p className="rounded-xl bg-warn/10 px-4 py-3 text-xs leading-snug text-warn">
          No rates have been set for you yet, so nothing below can be priced. Worth a nudge to
          {clientName}.
        </p>
      ) : null}

      {/* 3 — the months: reference and billing, not the first thing to parse. */}
      <section className="space-y-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          Your months <span className="normal-case text-ink-3">— by month, for pay and reference</span>
        </h2>
        {board.months.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong px-4 py-12 text-center text-sm text-ink-3">
            Nothing assigned to you yet.{" "}
            <Link href="/editing-bay" className="text-accent-hi hover:underline">
              Take something from the Editing Bay
            </Link>{" "}
            and it&rsquo;ll appear here under this month.
          </p>
        ) : (
          board.months.map((m) => (
            <MonthPanel
              key={m.month}
              data={m}
              currency={board.currency}
              defaultOpen={false}
              defaultLink={board.lastKnownPaymentLink}
              overdueIds={overdueIds}
              editorId={viewer.id}
            />
          ))
        )}
      </section>
    </div>
  );
}
