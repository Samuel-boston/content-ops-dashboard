import type { TrialInsightGroup } from "@/app/analytics-actions";

/**
 * Which hooks are winning their trials. Server-rendered and deliberately
 * simple: one card per tested video, trials ranked by views, the winner
 * starred. "No numbers yet" is shown as exactly that — trial insights only
 * exist in the IG app until someone types them in, and an empty cell must
 * not read as a zero.
 */
export function TrialPerformance({ groups }: { groups: TrialInsightGroup[] }) {
  if (groups.length === 0) return null;

  const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString());

  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold">Hook trials</h2>
        <p className="text-xs text-ink-3">
          Trial-reel numbers are carried over by hand from the IG app — &ldquo;—&rdquo; means not
          brought back yet, not zero.
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {groups.map((g) => {
          const best = g.trials.find((t) => t.views !== null);
          return (
            <div key={g.videoId} className="rounded-xl border border-line bg-card p-4">
              <p className="truncate text-sm font-medium">{g.videoTitle}</p>
              <div className="mt-2 space-y-1.5">
                {g.trials.map((t) => {
                  const share =
                    best?.views && t.views !== null ? Math.round((t.views / best.views) * 100) : null;
                  return (
                    <div key={t.id} className="flex items-center gap-2">
                      <span className="w-4 text-center text-xs">{t.winner ? "🏆" : ""}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-ink-2">{t.label}</span>
                      {t.status === "promoted" ? (
                        <span className="rounded bg-sky-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase text-sky-400">
                          On feed
                        </span>
                      ) : null}
                      <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-raised sm:block">
                        {share !== null ? (
                          <div className="h-full rounded-full bg-accent" style={{ width: `${share}%` }} />
                        ) : null}
                      </div>
                      <span className="w-16 text-right font-mono text-xs tabular-nums text-ink">
                        {fmt(t.views)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
