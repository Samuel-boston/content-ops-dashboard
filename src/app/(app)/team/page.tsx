import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { listTeam } from "@/app/actions";
import { teamSnapshots } from "@/app/team-actions";
import { getWorkspaceSettings } from "@/lib/workspace";
import { TeamManager } from "@/components/TeamManager";
import { Avatar } from "@/components/ui/Avatar";
import { EtaBadge } from "@/components/pipeline/Eta";
import { IconChevronRight } from "@/components/ui/icons";
import { displayName, money } from "@/lib/format";
import { STATUS_COLOR, STATUS_LABELS } from "@/lib/types";

export default async function TeamPage() {
  const viewer = await requireRole("owner", "admin");
  const [team, snapshots, settings] = await Promise.all([
    listTeam(),
    teamSnapshots(),
    getWorkspaceSettings(),
  ]);
  const currency = settings.currency ?? "USD";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Team</h1>
        <p className="text-sm text-ink-2">
          What each editor is holding, when it lands, and what shipped this month.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {snapshots.map((s) => (
          <div key={s.editor.id} className="min-w-0 rounded-2xl border border-line bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-3">
              <Avatar person={s.editor} size="lg" />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/team/${s.editor.id}`}
                  className="block truncate font-semibold hover:text-accent-hi"
                >
                  {displayName(s.editor)}
                </Link>
                <p className="truncate text-[11px] text-ink-3">{s.editor.email}</p>
              </div>
              <Link
                href={`/team/${s.editor.id}`}
                className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-2 hover:border-accent hover:text-ink"
              >
                Breakdown
                <IconChevronRight size={11} />
              </Link>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                { label: "In flight", value: s.inFlight.length },
                { label: "Posted this month", value: s.postedThisMonth },
                {
                  label: "Earned this month",
                  value:
                    s.earnedThisMonthCents !== null
                      ? money(s.earnedThisMonthCents, currency)
                      : "—",
                },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg bg-panel px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-ink-3">{stat.label}</p>
                  <p className="mt-0.5 text-base font-semibold tabular-nums">{stat.value}</p>
                </div>
              ))}
            </div>

            <div className="mt-3 space-y-1.5">
              {s.inFlight.length === 0 ? (
                <p className="rounded-lg bg-panel px-2.5 py-2 text-xs text-ink-3">
                  Nothing assigned right now.
                </p>
              ) : (
                s.inFlight.slice(0, 4).map((v) => (
                  <Link
                    key={v.id}
                    href={`/videos/${v.id}`}
                    className="flex items-center gap-2 rounded-lg bg-panel px-2.5 py-2 hover:bg-raised"
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: STATUS_COLOR[v.status] }}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs">{v.title}</span>
                    <span className="shrink-0 text-[10px] text-ink-3">
                      {STATUS_LABELS[v.status]}
                    </span>
                    <EtaBadge etaAt={v.eta_at} stage={v.eta_stage} className="shrink-0" />
                  </Link>
                ))
              )}
              {s.inFlight.length > 4 ? (
                <Link
                  href={`/team/${s.editor.id}`}
                  className="block px-2.5 text-[11px] text-ink-3 hover:text-ink-2"
                >
                  +{s.inFlight.length - 4} more
                </Link>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {snapshots.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-10 text-center text-sm text-ink-3">
          No editors yet — add a seat below.
        </p>
      ) : null}

      <section className="max-w-3xl">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          Seats
        </h2>
        <p className="mb-3 text-sm text-ink-2">
          {viewer.role === "owner"
            ? "You can add or remove Admin and Editor seats."
            : "You can add or remove Editor seats. Admin seats are Owner-only."}
        </p>
        <TeamManager team={team} viewer={viewer} />
      </section>
    </div>
  );
}
