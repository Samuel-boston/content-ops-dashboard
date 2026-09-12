import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { EtaBadge } from "@/components/pipeline/Eta";
import { IconChevronRight } from "@/components/ui/icons";
import { displayName, money } from "@/lib/format";
import { STATUS_COLOR, STATUS_LABELS } from "@/lib/types";
import type { EditorSnapshot } from "@/app/team-actions";

/**
 * Who's working on what, and when it lands. This is the answer to the client's
 * original problem — work scattered across Notion and Drive with no way to see
 * who had what.
 */
export function TeamStrip({
  snapshots,
  currency = "USD",
}: {
  snapshots: EditorSnapshot[];
  currency?: string;
}) {
  if (!snapshots.length) {
    return (
      <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-3">
        No editors yet. Add them in Team.
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {snapshots.map((s) => (
        <div key={s.editor.id} className="group relative">
          {/* Compact row — this is all that shows until you hover. */}
          <Link
            href={`/team/${s.editor.id}`}
            className="flex items-center gap-2.5 rounded-xl border border-line bg-card p-3 transition group-hover:border-line-strong"
          >
            <Avatar person={s.editor} size="md" />
            <div className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{displayName(s.editor)}</span>
              <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
                {s.inFlight.length} in flight
                {s.overdue.length ? (
                  <span className="text-danger">· {s.overdue.length} past ETA</span>
                ) : null}
              </span>
            </div>
            <IconChevronRight size={13} className="shrink-0 text-ink-3" />
          </Link>

          {/* Hover reveal — the full summary, without taking up space until asked for. */}
          <div className="pointer-events-none invisible absolute left-0 right-0 top-full z-20 pt-1.5 opacity-0 transition group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100">
            <div className="space-y-3 rounded-xl border border-line-strong bg-card p-4 shadow-2xl">
              <p className="text-[11px] text-ink-3">
                {s.inFlight.length} in flight · {s.postedThisMonth} posted this month
                {s.earnedThisMonthCents !== null
                  ? ` · ${money(s.earnedThisMonthCents, currency)}`
                  : ""}
              </p>

              <div className="space-y-1.5">
                {s.active.length === 0 ? (
                  <p className="rounded-lg bg-panel px-2.5 py-2 text-xs text-ink-3">
                    Not editing anything right now.
                  </p>
                ) : (
                  s.active.map((v) => (
                    <Link
                      key={v.id}
                      href={`/videos/${v.id}`}
                      className="flex items-center gap-2 rounded-lg bg-panel px-2.5 py-2 transition hover:bg-raised"
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: STATUS_COLOR[v.status] }}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs">{v.title}</span>
                      <EtaBadge etaAt={v.eta_at} stage={v.eta_stage} className="shrink-0" />
                    </Link>
                  ))
                )}
              </div>

              {s.awaitingApproval.length ? (
                <p className="text-[11px] text-ink-3">
                  Also with you:{" "}
                  {s.awaitingApproval.map((v, i) => (
                    <span key={v.id}>
                      {i > 0 ? " · " : ""}
                      <Link href={`/videos/${v.id}`} className="text-ink-2 hover:text-accent-hi">
                        {v.title}
                      </Link>{" "}
                      <span className="text-ink-3">({STATUS_LABELS[v.status]})</span>
                    </span>
                  ))}
                </p>
              ) : null}

              {s.missingEta.length || s.overdue.length ? (
                <p className="flex flex-wrap gap-2 text-[11px]">
                  {s.overdue.length ? (
                    <span className="text-danger">{s.overdue.length} past ETA</span>
                  ) : null}
                  {s.missingEta.length ? (
                    <span className="text-warn">{s.missingEta.length} with no ETA</span>
                  ) : null}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
