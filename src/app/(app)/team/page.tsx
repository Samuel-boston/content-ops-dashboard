import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { listTeam } from "@/app/actions";
import { teamSnapshots } from "@/app/team-actions";
import { getWorkspaceSettings } from "@/lib/workspace";
import { TeamManager } from "@/components/TeamManager";
import { listVaTasks } from "@/app/task-actions";
import { listTimeOff } from "@/app/pricing-actions";
import { VaTaskBoard } from "@/components/tasks/VaTaskBoard";
import { Avatar } from "@/components/ui/Avatar";
import { EtaBadge } from "@/components/pipeline/Eta";
import { IconChevronRight } from "@/components/ui/icons";
import { dayMonth, displayName, money } from "@/lib/format";
import { STATUS_COLOR, STATUS_LABELS, type VideoStatus } from "@/lib/types";
import { supabaseServer } from "@/lib/supabase/server";

export default async function TeamPage() {
  const viewer = await requireRole("owner", "admin");
  const [team, snapshots, settings, vaTasks, timeOff] = await Promise.all([
    listTeam(),
    teamSnapshots(),
    getWorkspaceSettings(),
    listVaTasks(),
    listTimeOff(),
  ]);
  const todayISO = new Date().toISOString().slice(0, 10);
  const away = timeOff.filter((t) => t.ends_on >= todayISO).slice(0, 12);
  const vas = team.filter((p) => p.role === "va" && p.active);
  const copywriters = team.filter((p) => p.role === "copywriter" && p.active);
  const currency = settings.currency ?? "USD";

  // The two seats that don't hold assigned videos: what's in the script pipeline (the copywriter's
  // world) and what is with the VA to post. Counted per stage so any new seat just gets a card.
  const supabase = await supabaseServer();
  const { data: stageRows } = await supabase
    .from("videos")
    .select("status")
    .is("parked_at", null)
    .in("status", ["ideation", "scripting", "ready_to_film", "with_va"]);
  const stageCount = (st: VideoStatus) => (stageRows ?? []).filter((r) => r.status === st).length;
  const openTasks = vaTasks.filter((t) => t.status === "todo").length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Team</h1>
        <p className="text-sm text-ink-2">
          Everyone on the team — editors&rsquo; work and pay, the copywriter&rsquo;s scripting pipeline, and the VA&rsquo;s posting desk.
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

      {/* Copywriters: the scripting pipeline, stage by stage. */}
      {copywriters.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Copywriter{copywriters.length > 1 ? "s" : ""}
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {copywriters.map((p) => (
              <Link
                key={p.id}
                href={`/team/${p.id}`}
                className="min-w-0 rounded-2xl border border-line bg-card p-4 transition hover:border-accent sm:p-5"
              >
                <div className="flex items-center gap-3">
                  <Avatar person={p} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{displayName(p)}</p>
                    <p className="truncate text-[11px] text-ink-3">{p.email}</p>
                  </div>
                  <span className="flex items-center gap-1 text-[11px] text-ink-3">
                    Open <IconChevronRight size={11} />
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(["ideation", "scripting", "ready_to_film"] as VideoStatus[]).map((st) => (
                    <div key={st} className="rounded-lg bg-panel px-2.5 py-2">
                      <p className="truncate text-[10px] uppercase tracking-wider text-ink-3">{STATUS_LABELS[st]}</p>
                      <p className="mt-0.5 text-base font-semibold tabular-nums">{stageCount(st)}</p>
                    </div>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {away.length > 0 ? (
        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Away
          </h2>
          <div className="flex flex-wrap gap-2">
            {away.map((t) => {
              const who = team.find((p) => p.id === t.editor_id);
              return (
                <span key={t.id} className="rounded-lg border border-line bg-card px-3 py-1.5 text-xs">
                  <span className="font-medium">{who ? displayName(who) : "Someone"}</span>
                  <span className="text-ink-3">
                    {" "}
                    · {dayMonth(t.starts_on)}
                    {t.ends_on !== t.starts_on ? ` – ${dayMonth(t.ends_on)}` : ""}
                  </span>
                </span>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11px] text-ink-3">
            Each person sets their own days from Time off in their account menu.
          </p>
        </section>
      ) : null}

      {/* The VA has no video work to hold, so their card is the task list you give them. */}
      <section className="space-y-3">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            VA{vas.length > 1 ? "s" : ""}
            {vas.length ? ` — ${vas.map((v) => displayName(v)).join(", ")}` : ""}
          </h2>
          <p className="mt-1 text-sm text-ink-2">
            {vas.length === 0
              ? "No VA seat yet — add one below, then give them tasks here."
              : `${vaTasks.filter((t) => t.status === "todo").length} open · give them a task, and see what's been done.`}
          </p>
        </div>
        {vas.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {vas.map((p) => (
              <Link
                key={p.id}
                href={`/team/${p.id}`}
                className="min-w-0 rounded-2xl border border-line bg-card p-4 transition hover:border-accent sm:p-5"
              >
                <div className="flex items-center gap-3">
                  <Avatar person={p} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{displayName(p)}</p>
                    <p className="truncate text-[11px] text-ink-3">{p.email}</p>
                  </div>
                  <span className="flex items-center gap-1 text-[11px] text-ink-3">
                    Open their dashboard <IconChevronRight size={11} />
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-panel px-2.5 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-ink-3">To post</p>
                    <p className="mt-0.5 text-base font-semibold tabular-nums">{stageCount("with_va")}</p>
                  </div>
                  <div className="rounded-lg bg-panel px-2.5 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-ink-3">Open tasks</p>
                    <p className="mt-0.5 text-base font-semibold tabular-nums">{openTasks}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : null}
        <VaTaskBoard tasks={vaTasks} canManage />
      </section>

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
