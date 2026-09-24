import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { listTeam } from "@/app/actions";
import { listPostedVideos, listPostingWork } from "@/app/posting-actions";
import { listVaTasks } from "@/app/task-actions";
import { getClientName } from "@/lib/workspace";
import { PostingBoard } from "@/components/posting/PostingBoard";
import { VaTaskBoard } from "@/components/tasks/VaTaskBoard";
import { supabaseServer } from "@/lib/supabase/server";
import { STATUS_COLOR, STATUS_LABELS, type VideoStatus } from "@/lib/types";
import { listTaxonomyCustoms } from "@/app/actions";
import { editorSnapshot } from "@/app/team-actions";
import {
  editorMonthEarnings,
  editorMonths,
  editorMonthMarkers,
  listEditorRates,
  listPayments,
  monthBilling,
  listTimeOff,
} from "@/app/pricing-actions";
import { getWorkspaceSettings } from "@/lib/workspace";
import { Avatar } from "@/components/ui/Avatar";
import { EditorRates } from "@/components/team/EditorRates";
import { PaymentControls, TimeOffPanel } from "@/components/team/MonthActions";
import { MonthPicker } from "@/components/team/MonthPicker";
import { VideoList } from "@/components/pipeline/VideoRow";
import { IconChevronRight } from "@/components/ui/icons";
import { dayMonth, displayName, money } from "@/lib/format";
import { FORMATS } from "@/lib/taxonomy";

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

export default async function EditorPage({
  params,
  searchParams,
}: PageProps<"/team/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const viewer = await requireUser();

  // Editors can open their own page; everyone else needs to be staff-side.
  if (viewer.role === "editor" && viewer.id !== id) notFound();

  // Not everyone on the team is an editor: the VA and the copywriter get their own view here.
  if (viewer.role === "owner" || viewer.role === "admin") {
    const person = (await listTeam()).find((p) => p.id === id);
    if (person?.role === "va") return <VaPerson person={person} />;
    if (person?.role === "copywriter") return <CopywriterPerson person={person} />;
  }

  const snapshot = await editorSnapshot(id);
  if (!snapshot) notFound();

  const [months, markers] = await Promise.all([editorMonths(id), editorMonthMarkers(id)]);
  const month = typeof sp.month === "string" && months.includes(sp.month) ? sp.month : months[0];

  const [earnings, rates, customs, settings, payments, timeOff, billing] = await Promise.all([
    editorMonthEarnings(id, month),
    listEditorRates(id),
    listTaxonomyCustoms(),
    getWorkspaceSettings(),
    listPayments(id),
    listTimeOff(id),
    monthBilling(id, month),
  ]);

  const currency = settings.currency ?? "USD";
  const canSeePay = viewer.role === "owner" || viewer.id === id;
  const formats = [
    ...FORMATS,
    ...customs.filter((c) => c.kind === "format").map((c) => c.value),
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/team" className="text-sm text-ink-3 hover:text-ink">
          Team
        </Link>
        <IconChevronRight size={12} className="text-ink-3" />
        <Avatar person={snapshot.editor} size="lg" />
        <div>
          <h1 className="text-xl font-semibold">{displayName(snapshot.editor)}</h1>
          <p className="text-sm text-ink-3">{snapshot.editor.email}</p>
        </div>
      </div>

      {/* Right now */}
      <section>
        <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          On their plate
        </h2>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "In flight", value: snapshot.inFlight.length },
            { label: "Editing now", value: snapshot.active.length },
            { label: "Past ETA", value: snapshot.overdue.length, warn: snapshot.overdue.length > 0 },
            { label: "No ETA set", value: snapshot.missingEta.length, warn: snapshot.missingEta.length > 0 },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-line bg-card px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wider text-ink-3">{s.label}</p>
              <p
                className={`mt-0.5 text-lg font-semibold tabular-nums ${
                  s.warn ? "text-warn" : ""
                }`}
              >
                {s.value}
              </p>
            </div>
          ))}
        </div>
        <VideoList
          videos={snapshot.inFlight}
          empty="Nothing assigned to them right now."
        />
      </section>

      {/* Month */}
      <section>
        <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          Delivered
        </h2>
        {markers.length > 0 ? (
          <div className="mb-3">
            <MonthPicker editorId={id} markers={markers} selected={month} />
          </div>
        ) : null}

        {earnings ? (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-4 rounded-xl border border-line bg-card px-4 py-3">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-ink-3">
                  {monthLabel(month)}
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {earnings.count} video{earnings.count === 1 ? "" : "s"}
                </p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-[10px] uppercase tracking-wider text-ink-3">Total</p>
                <p className="text-lg font-semibold tabular-nums text-ok">
                  {money(earnings.total_cents, currency, { maximumFractionDigits: 2 })}
                </p>
              </div>
              <div className="w-full">
                <PaymentControls
                  editorId={id}
                  month={month}
                  totalCents={earnings.total_cents}
                  currency={currency}
                  payment={payments.find((p) => p.month === month) ?? null}
                  isOwner={viewer.role === "owner"}
                  paymentLink={billing?.payment_link ?? null}
                  paymentNote={billing?.note ?? null}
                />
              </div>
            </div>

            {earnings.videos.length === 0 ? (
              <p className="rounded-xl border border-line bg-card px-4 py-8 text-center text-sm text-ink-3">
                Nothing posted in {monthLabel(month)}.
              </p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-line bg-app">
                {earnings.videos.map((v) => (
                  <div
                    key={v.id}
                    className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5 last:border-0"
                  >
                    <Link
                      href={`/videos/${v.id}`}
                      className="min-w-[140px] flex-1 truncate text-sm hover:text-accent-hi"
                    >
                      {v.title}
                    </Link>
                    <span className="shrink-0 text-[11px] text-ink-3">
                      {v.breakdown?.format ?? v.formats[0] ?? "—"}
                    </span>
                    {v.breakdown?.extra_variants ? (
                      <span className="shrink-0 text-[11px] text-ink-3">
                        +{v.breakdown.extra_variants} variant
                        {v.breakdown.extra_variants === 1 ? "" : "s"}
                      </span>
                    ) : null}
                    <span className="shrink-0 text-[11px] text-ink-3">
                      {dayMonth(v.posted_at)}
                    </span>
                    <span className="w-20 shrink-0 text-right text-sm tabular-nums">
                      {money(v.price_cents, currency, { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="rounded-xl border border-line bg-card px-4 py-8 text-center text-sm text-ink-3">
            Earnings are visible to the owner and to the editor themselves.
          </p>
        )}
      </section>

      <section className="max-w-2xl">
        <TimeOffPanel
          editorId={id}
          entries={timeOff}
          canEdit={viewer.role === "owner" || viewer.id === id}
        />
      </section>

      {/* Rates */}
      {canSeePay ? (
        <section className="max-w-2xl">
          <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Rates
          </h2>
          <EditorRates
            editorId={id}
            formats={formats}
            rates={rates}
            surchargeCents={settings.hook_variant_surcharge_cents ?? 200}
            currency={currency}
            canEdit={viewer.role === "owner"}
          />
        </section>
      ) : null}
    </div>
  );
}

type Person = Awaited<ReturnType<typeof listTeam>>[number];

/** The VA's dashboard, as the client sees it: what's with them to post, the archive, and their tasks. */
async function VaPerson({ person }: { person: Person }) {
  const [{ trials, jobs, instagramConnected, publerConnected, channels }, archive, tasks, clientName] = await Promise.all([
    listPostingWork(),
    listPostedVideos(),
    listVaTasks(),
    getClientName(),
  ]);
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/team" className="text-sm text-ink-3 hover:text-ink">
          ← Team
        </Link>
        <Avatar person={person} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{displayName(person)}</h1>
          <p className="text-sm text-ink-2">VA — {person.email}</p>
        </div>
      </div>
      <section className="space-y-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Posting desk</h2>
        <PostingBoard trials={trials} jobs={jobs} archive={archive} instagramConnected={instagramConnected} publerConnected={publerConnected} channels={channels} clientName={clientName} />
      </section>
      <section className="space-y-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Tasks</h2>
        <VaTaskBoard tasks={tasks} canManage />
      </section>
    </div>
  );
}

/** The copywriter's world: every script, by stage, straight into its script room. */
async function CopywriterPerson({ person }: { person: Person }) {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("videos")
    .select("id, title, status, priority")
    .is("parked_at", null)
    .in("status", ["ideation", "scripting", "ready_to_film"])
    .order("stage_entered_at", { ascending: true });
  const stages: VideoStatus[] = ["ideation", "scripting", "ready_to_film"];
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/team" className="text-sm text-ink-3 hover:text-ink">
          ← Team
        </Link>
        <Avatar person={person} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{displayName(person)}</h1>
          <p className="text-sm text-ink-2">Copywriter — {person.email}</p>
        </div>
        <Link href="/board" className="ml-auto rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink">
          Open the scripting board →
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {stages.map((st) => {
          const list = (data ?? []).filter((v) => v.status === st);
          return (
            <div key={st} className="min-w-0 rounded-xl border border-line bg-app p-2">
              <div className="flex items-center gap-2 px-1 pb-2">
                <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[st] }} />
                <h2 className="text-sm font-medium">{STATUS_LABELS[st]}</h2>
                <span className="text-xs text-ink-3">{list.length}</span>
              </div>
              <div className="space-y-1.5">
                {list.length === 0 ? <p className="px-2 py-4 text-center text-xs text-ink-3">Nothing here.</p> : null}
                {list.map((v) => (
                  <Link
                    key={v.id}
                    href={`/videos/${v.id}`}
                    className="block truncate rounded-lg border border-line bg-card px-2.5 py-2 text-xs hover:border-accent"
                  >
                    {v.title}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
