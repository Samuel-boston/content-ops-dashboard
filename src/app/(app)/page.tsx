import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listEditors, listTaxonomyCustoms, stageCounts } from "@/app/actions";
import { clientActions, teamSnapshots } from "@/app/team-actions";
import { getWorkspaceSettings } from "@/lib/workspace";
import { ACTIVE_STATUSES, STATUS_COLOR, STATUS_LABELS } from "@/lib/types";
import { OverviewReport } from "@/components/overview/OverviewReport";
import { timeGreeting } from "@/lib/greeting";
import type { OverviewItemInput } from "@/app/assistant-actions";
import { TeamStrip } from "@/components/overview/TeamStrip";
import { PerformancePanel, RunwayPanel } from "@/components/overview/Pulse";
import {
  markOverviewSeenAction,
  performance as performanceData,
  runway as runwayData,
  whatsNew,
} from "@/app/overview-actions";
import { CreateVideoButton } from "@/components/CreateVideoButton";

export default async function OverviewPage() {
  const viewer = await requireUser();
  if (viewer.role === "editor") redirect("/my-work");

  const [counts, actions, team, editors, customs, settings, perf, runway, news] =
    await Promise.all([
      stageCounts(),
      clientActions(),
      teamSnapshots(),
      listEditors(),
      listTaxonomyCustoms(),
      getWorkspaceSettings(),
      performanceData(),
      runwayData(),
      whatsNew(),
    ]);

  // Move the watermark only after "what's new" has been read, so this render
  // still shows what it found. The next visit starts from here.
  await markOverviewSeenAction();

  const customsBy = {
    content_pillar: customs.filter((c) => c.kind === "content_pillar").map((c) => c.value),
    format: customs.filter((c) => c.kind === "format").map((c) => c.value),
    platform: customs.filter((c) => c.kind === "platform").map((c) => c.value),
  };

  const totalActive = ACTIVE_STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0);
  const firstName = viewer.full_name?.split(" ")[0] || "";

  const items: OverviewItemInput[] = [
    ...actions.toFinalReview.map((v) => ({ id: v.id, title: v.title, status: v.status, kind: "final_review" as const })),
    ...actions.toReview.map((v) => ({ id: v.id, title: v.title, status: v.status, kind: "review" as const })),
    ...actions.readyToPost.map((v) => ({ id: v.id, title: v.title, status: v.status, kind: "ready_to_post" as const })),
    ...actions.toFilm.map((v) => ({ id: v.id, title: v.title, status: v.status, kind: "to_film" as const })),
  ];

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {timeGreeting()}{firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="text-sm text-ink-2">
            {totalActive} video{totalActive === 1 ? "" : "s"} in flight · {counts.posted} posted
            all-time
          </p>
        </div>
        <CreateVideoButton editors={editors} customs={customsBy} viewerId={viewer.id} />
      </div>

      {/* 1 — the merged report: Andreas's opener + real clickable picks, then what's blocked on the client, then what moved without them. Stalled/overdue videos live in the nav's caution icon instead — a different kind of alert than this. */}
      <OverviewReport
        firstName={firstName}
        items={items}
        toReview={actions.toReview.length}
        toFinalReview={actions.toFinalReview.length}
        readyToPost={actions.readyToPost.length}
        toFilm={actions.toFilm.length}
        poolCount={actions.poolCount}
        poolRunningDry={actions.poolRunningDry}
        news={news}
      />

      {/* 2 — how it's going, and how long it lasts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PerformancePanel data={perf} />
        <RunwayPanel data={runway} />
      </div>

      {/* 2 — the pipeline at a glance */}
      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Pipeline
          </h2>
          <Link href="/board" className="text-xs text-ink-2 hover:text-ink">
            Full board →
          </Link>
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {ACTIVE_STATUSES.map((s) => (
            <Link
              key={s}
              href="/board"
              className="min-w-28 flex-1 rounded-xl border border-line bg-card px-3 py-2.5 transition hover:border-line-strong hover:bg-raised"
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: STATUS_COLOR[s] }}
                />
                <span className="truncate text-[11px] text-ink-3">{STATUS_LABELS[s]}</span>
              </span>
              <span className="mt-0.5 block text-lg font-semibold tabular-nums">
                {counts[s] ?? 0}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* 3 — who has what */}
      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            The team
          </h2>
          <Link href="/team" className="text-xs text-ink-2 hover:text-ink">
            Full breakdown →
          </Link>
        </div>
        <TeamStrip snapshots={team} currency={settings.currency ?? "USD"} />
      </section>
    </div>
  );
}
