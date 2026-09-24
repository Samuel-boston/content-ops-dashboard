/**
 * One way to show an upload, everywhere. It answers the two questions people
 * actually have: "is it done yet?" and "can I close this page?".
 *
 *  uploading   — the file is still leaving this browser → keep the page open.
 *  processing  — the file is safe on our side and something else is finishing
 *                it in the background → the page can be closed.
 *  done        — nothing more will happen.
 */
export interface UploadState {
  phase: "uploading" | "processing" | "done" | "error";
  /** What is being uploaded, e.g. "Raw footage" or "Finished video". */
  title: string;
  /** 0–100 while uploading. */
  pct?: number | null;
  /** e.g. "Step 1 of 3". */
  step?: string;
  /** The file name, or what is happening in the background. */
  detail?: string;
  /** Replaces the default "Finished" line, when there is a next step. */
  doneText?: string;
  /** Extra line (a warning that isn't an error). */
  note?: string;
}

export function UploadStatus({ state, className = "" }: { state: UploadState; className?: string }) {
  const { phase } = state;
  const tone = phase === "error" ? "border-danger/40" : phase === "done" ? "border-ok/40" : "border-line-strong";
  return (
    <div role="status" aria-live="polite" className={`rounded-lg border bg-raised px-3 py-2.5 text-left ${tone} ${className}`}>
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
          {phase === "done" ? "✓ " : ""}
          {state.title}
        </span>
        {state.step ? <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-3">{state.step}</span> : null}
        {phase === "uploading" ? (
          <span className="shrink-0 font-mono text-xs text-ink-2">{state.pct ?? 0}%</span>
        ) : null}
      </div>

      {phase === "uploading" || phase === "processing" ? (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-hover">
          {phase === "uploading" ? (
            <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${state.pct ?? 0}%` }} />
          ) : (
            <div className="h-full w-full animate-pulse rounded-full bg-accent/50" />
          )}
        </div>
      ) : null}

      {state.detail ? <p className="mt-1.5 truncate text-[11px] text-ink-3">{state.detail}</p> : null}

      {phase === "uploading" ? (
        <p className="mt-1 text-[11px] font-medium text-warn">Keep this page open until it reaches 100%.</p>
      ) : null}
      {phase === "processing" ? (
        <p className="mt-1 text-[11px] font-medium text-ok">Upload finished — you can close this page. The rest happens on its own.</p>
      ) : null}
      {phase === "done" ? <p className="mt-1 text-[11px] font-medium text-ok">{state.doneText ?? "Finished — nothing more to do."}</p> : null}
      {phase === "error" ? <p className="mt-1 text-[11px] font-medium text-danger">Not uploaded. Try again.</p> : null}
      {state.note ? <p className="mt-1 text-[11px] text-warn">{state.note}</p> : null}
    </div>
  );
}
