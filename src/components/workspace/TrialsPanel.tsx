"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import {
  archiveTrialAction,
  listVideoTrials,
  markTrialPostedAction,
  markTrialWinnerAction,
  promoteTrialAction,
  queueTrialAction,
  saveTrialMetricsAction,
  sendToVaAction,
  setPostAsAction,
  updateTrialAction,
} from "@/app/trial-actions";
import { createFootageUploadUrlAction } from "@/app/asset-actions";
import { IconClock, IconTrash } from "@/components/ui/icons";
import { TRIAL_STATUS_LABELS, type TrialPost } from "@/lib/types";

/**
 * Hook testing, made visible. Every hook variant can be queued as an
 * Instagram TRIAL reel; the VA posts them by hand from the Posting desk
 * (Meta's API can't post or read trials), the numbers get typed in from the
 * app's insights, the client stars the winner, and Promote hands the exact
 * cut to the ordinary publish pipeline. This panel is the manager's view of
 * that whole loop, scoped to one video.
 */
export function TrialsPanel({
  videoId,
  vaNotes = null,
  vaSentAt = null,
  hasCover = false,
}: {
  videoId: string;
  vaNotes?: string | null;
  vaSentAt?: string | null;
  hasCover?: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();
  const [trials, setTrials] = useState<TrialPost[] | null>(null);
  const [cuts, setCuts] = useState<{ id: string; label: string; kind: string }[]>([]);
  const [pickCut, setPickCut] = useState("");
  const [notes, setNotes] = useState(vaNotes ?? "");
  const [coverPath, setCoverPath] = useState<string | null>(null);
  const [coverName, setCoverName] = useState<string | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const coverInput = useRef<HTMLInputElement>(null);

  async function uploadCover(file: File) {
    if (file.size > 20 * 1024 * 1024) {
      toast.error("Keep the cover under 20 MB.");
      return;
    }
    setUploadingCover(true);
    const up = await createFootageUploadUrlAction(videoId, file.name);
    if (!up?.ok) {
      toast.error(up?.error ?? "Could not start the upload.");
      setUploadingCover(false);
      return;
    }
    try {
      const put = await fetch(up.signedUrl, { method: "PUT", body: file, headers: { "x-upsert": "true" } });
      if (!put.ok) throw new Error(`Upload failed (${put.status}).`);
      setCoverPath(up.path);
      setCoverName(file.name);
    } catch (e) {
      toast.error((e as Error).message);
    }
    setUploadingCover(false);
  }

  async function reload() {
    const res = await listVideoTrials(videoId);
    setTrials(res.trials.filter((t) => t.status !== "archived"));
    setCuts(res.cuts);
  }
  useEffect(() => {
    // Load on open; the panel lives inside a tab, so this runs once per
    // visit. setState happens in the promise callback (external data
    // arriving), never synchronously in the effect body.
    let cancelled = false;
    listVideoTrials(videoId).then((res) => {
      if (cancelled) return;
      setTrials(res.trials.filter((t) => t.status !== "archived"));
      setCuts(res.cuts);
    });
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  function run(fn: () => Promise<{ error?: string } | void>, then?: () => void) {
    startTransition(async () => {
      const res = await fn();
      if (res && "error" in res && res.error) toast.error(res.error);
      else {
        then?.();
        await reload();
        router.refresh();
      }
    });
  }

  const hookCuts = cuts.filter((c) => c.kind === "hook");
  const unqueued = hookCuts.filter(
    (c) => !(trials ?? []).some((t) => t.cut_id === c.id && t.status !== "archived")
  );

  if (trials === null) {
    return <p className="px-1 py-3 text-xs text-ink-3">Loading trials…</p>;
  }

  const field =
    "rounded-md border border-line bg-raised px-2 py-1 text-xs placeholder:text-ink-3 focus:border-accent focus:outline-none";

  return (
    <section className="mt-4 rounded-xl border border-line bg-card p-3">
      {/* The hand-off: nothing reaches the VA until this is pressed. */}
      <div className="mb-3 space-y-2 rounded-lg border border-accent/30 bg-accent-ghost p-2.5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Send to the VA</h3>
          {vaSentAt ? (
            <span className="rounded-md bg-ok/15 px-1.5 py-0.5 text-[10px] font-medium text-ok">
              Sent {new Date(vaSentAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </span>
          ) : null}
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Notes for the VA — what to say, when to post, anything specific."
          className="w-full resize-y rounded-md border border-line bg-raised px-2.5 py-2 text-xs placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => coverInput.current?.click()}
            disabled={uploadingCover}
            className="rounded-md border border-line bg-card px-2.5 py-1.5 text-[11px] text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
          >
            {uploadingCover ? "Uploading…" : coverName ? `Cover: ${coverName}` : hasCover ? "Replace the cover" : "Upload a cover"}
          </button>
          <input
            ref={coverInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadCover(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={pending || uploadingCover}
            onClick={() =>
              run(() => sendToVaAction({ videoId, notes, coverPath }), () => {
                toast.success(vaSentAt ? "Updated for the VA." : "Sent to the VA.");
              })
            }
            className="ml-auto rounded-md bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:bg-accent-hi disabled:opacity-50"
          >
            {vaSentAt ? "Send again / update" : "Send to the VA"}
          </button>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Variants</h3>
        <span className="text-xs text-ink-3">{trials.length}</span>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-ink-3">
        Each variant is either posted as a trial reel or straight to the main feed — pick per
        variant; the VA sees the same choice. Trials post by hand (Instagram&rsquo;s API can&rsquo;t
        touch them). Star a winner, then promote it to the main feed.
      </p>

      {trials.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-ink-3">
          No trials yet.{" "}
          Press &ldquo;Send to the VA&rdquo; above and the main cut and every variant land on their
          Posting desk.
        </div>
      ) : (
        <div className="space-y-2">
          {trials.map((t) => (
            <TrialRow key={t.id} trial={t} videoId={videoId} pending={pending} run={run} field={field} />
          ))}
        </div>
      )}

      {unqueued.length > 0 ? (
        <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
          <select value={pickCut} onChange={(e) => setPickCut(e.target.value)} className={field}>
            <option value="">Queue one variant…</option>
            {unqueued.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              const cut = unqueued.find((c) => c.id === pickCut);
              if (!cut) return;
              run(
                () => queueTrialAction({ videoId, cutId: cut.id, label: cut.label }),
                () => setPickCut("")
              );
            }}
            disabled={pending || !pickCut}
            className="rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
          >
            Queue
          </button>
        </div>
      ) : null}
    </section>
  );
}

function TrialRow({
  trial: t,
  videoId,
  pending,
  run,
  field,
}: {
  trial: TrialPost;
  videoId: string;
  pending: boolean;
  run: (fn: () => Promise<{ error?: string } | void>, then?: () => void) => void;
  field: string;
}) {
  const [permalink, setPermalink] = useState(t.permalink ?? "");
  const [when, setWhen] = useState("");
  const [m, setM] = useState({
    views: t.views?.toString() ?? "",
    likes: t.likes?.toString() ?? "",
    shares: t.shares?.toString() ?? "",
  });
  const [editingNumbers, setEditingNumbers] = useState(false);

  const chip =
    t.status === "planned"
      ? "bg-amber-500/15 text-amber-400"
      : t.status === "posted"
        ? "bg-emerald-500/15 text-emerald-400"
        : t.status === "promoted"
          ? "bg-sky-500/15 text-sky-400"
          : "bg-raised text-ink-3";

  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  return (
    <div className="rounded-lg border border-line bg-raised/60 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          title={t.winner ? "Winning hook" : "Mark as the winning hook"}
          onClick={() => run(() => markTrialWinnerAction(t.id, videoId))}
          disabled={pending || t.winner}
          className={`text-sm ${t.winner ? "" : "opacity-30 hover:opacity-80"}`}
        >
          🏆
        </button>
        <p className="min-w-0 flex-1 truncate text-xs font-medium">{t.label}</p>
        {t.status === "planned" ? (
          <select
            value={t.post_as ?? "trial"}
            disabled={pending}
            onChange={(e) => run(() => setPostAsAction(t.id, videoId, e.target.value as "trial" | "main"))}
            aria-label="Post as"
            className={field}
          >
            <option value="trial">Trial reel</option>
            <option value="main">Post to main feed</option>
          </select>
        ) : (
          <span className="rounded-md bg-raised px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">
            {t.post_as === "main" ? "Main feed" : "Trial"}
          </span>
        )}
        <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${chip}`}>
          {TRIAL_STATUS_LABELS[t.status]}
        </span>
        <button
          title="Archive this trial"
          onClick={() => run(() => archiveTrialAction(t.id, videoId))}
          disabled={pending}
          className="text-ink-3 hover:text-red-400"
        >
          <IconTrash size={12} />
        </button>
      </div>

      {t.views !== null || t.likes !== null ? (
        <p className="mt-1.5 text-[11px] text-ink-2">
          {t.views !== null ? <span className="mr-3">{t.views.toLocaleString()} views</span> : null}
          {t.likes !== null ? <span className="mr-3">{t.likes.toLocaleString()} likes</span> : null}
          {t.shares !== null ? <span>{t.shares.toLocaleString()} shares</span> : null}
          <button
            onClick={() => setEditingNumbers((v) => !v)}
            className="ml-2 text-[10px] text-accent hover:underline"
          >
            edit
          </button>
        </p>
      ) : null}

      {t.status === "planned" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-[10px] text-ink-3">
            <IconClock size={11} />
            <input
              type="datetime-local"
              defaultValue={t.scheduled_for ? t.scheduled_for.slice(0, 16) : ""}
              onBlur={(e) =>
                e.target.value !== (t.scheduled_for?.slice(0, 16) ?? "") &&
                run(() => updateTrialAction(t.id, videoId, { scheduled_for: e.target.value || null }))
              }
              className={field}
            />
          </label>
          <input
            value={permalink}
            onChange={(e) => setPermalink(e.target.value)}
            placeholder="Posted it yourself? Paste the link…"
            className={`${field} min-w-0 flex-1`}
          />
          <button
            onClick={() => run(() => markTrialPostedAction(t.id, videoId, permalink))}
            disabled={pending || !permalink.trim()}
            className="rounded-md border border-line px-2 py-1 text-[10px] text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
          >
            Mark live
          </button>
        </div>
      ) : null}

      {(t.status === "posted" && (editingNumbers || (t.views === null && t.likes === null))) ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {(["views", "likes", "shares"] as const).map((k) => (
            <input
              key={k}
              value={m[k]}
              onChange={(e) => setM((prev) => ({ ...prev, [k]: e.target.value }))}
              placeholder={k}
              inputMode="numeric"
              className={`${field} w-20`}
            />
          ))}
          <button
            onClick={() =>
              run(
                () =>
                  saveTrialMetricsAction(t.id, videoId, {
                    views: num(m.views),
                    likes: num(m.likes),
                    shares: num(m.shares),
                  }),
                () => setEditingNumbers(false)
              )
            }
            disabled={pending}
            className="rounded-md border border-line px-2 py-1 text-[10px] text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
          >
            Save
          </button>
        </div>
      ) : null}

      {t.status === "posted" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line/60 pt-2">
          {t.permalink ? (
            <a href={t.permalink} target="_blank" rel="noreferrer" className="text-[10px] text-accent hover:underline">
              Open trial ↗
            </a>
          ) : null}
          <span className="ml-auto flex items-center gap-1.5">
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className={field}
              title="Schedule the promotion (leave empty to publish now)"
            />
            <button
              onClick={() => run(() => promoteTrialAction(t.id, videoId, when || null), () => setWhen(""))}
              disabled={pending}
              className="rounded-md bg-accent px-2.5 py-1 text-[10px] font-medium text-white hover:bg-accent-hi disabled:opacity-50"
            >
              {when ? "Schedule promotion" : "Promote to feed now"}
            </button>
          </span>
        </div>
      ) : null}

      {t.status === "promoted" ? (
        <p className="mt-1.5 text-[10px] text-ink-3">
          Promoted — live metrics flow in through the API on the Analytics page.
        </p>
      ) : null}
    </div>
  );
}
