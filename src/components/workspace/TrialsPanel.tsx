"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import {
  archiveTrialAction,
  getCutPlaybackAction,
  listVideoTrials,
  markTrialPostedAction,
  markTrialWinnerAction,
  promoteTrialAction,
  saveTrialMetricsAction,
  saveVaCoverAction,
  saveVaNotesAction,
  sendToVaAction,
  takeBackFromVaAction,
  updateVariantAction,
} from "@/app/trial-actions";
import { createFootageUploadUrlAction } from "@/app/asset-actions";
import { StreamPlayer } from "@/components/engine/StreamPlayer";
import { IconTrash } from "@/components/ui/icons";
import type { TrialPost, VideoStatus } from "@/lib/types";
import { SETTABLE_STATES, STATE_LABELS, STATE_TONE, variantState, type VariantState } from "@/lib/variant-state";
import { vaSetVariantStateAction } from "@/app/posting-actions";

/**
 * Variants — every version of this video that could go out (the main cut and
 * each hook variant), what to do with each one, and the hand-off to the VA.
 *
 * Nothing reaches the VA by existing: each variant is a draft with a
 * destination — Not selected, Trial reel, or Main feed — and its own caption,
 * and goes across only when it's sent (one at a time, or all the chosen ones
 * together with the notes and cover). Trials are posted by hand (Meta's API
 * can't touch them); once one has numbers the client stars a winner and
 * Promote hands the exact cut to the ordinary publish pipeline.
 */
export function TrialsPanel({
  videoId,
  vaNotes = null,
  status,
  hasCover = false,
  fallbackCaption = "",
  onWatch,
  onSent,
}: {
  videoId: string;
  vaNotes?: string | null;
  /** The video's stage: Ready to Post shows the hand-off, With the VA shows the take-back. */
  status: VideoStatus;
  /** Called once the video has been sent to (or taken back from) the VA. */
  onSent?: () => void;
  hasCover?: boolean;
  /** The Post tab's caption box — used for any variant that hasn't got its own. */
  fallbackCaption?: string;
  onWatch?: (cutId: string) => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();
  const [trials, setTrials] = useState<TrialPost[] | null>(null);
  const [cuts, setCuts] = useState<{ id: string; label: string; kind: string }[]>([]);
  const [notes, setNotes] = useState(vaNotes ?? "");
  const [coverPath, setCoverPath] = useState<string | null>(null);
  const [coverName, setCoverName] = useState<string | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  // Which variant is open for editing: one at a time, so its caption box can be a proper size.
  // null = the first one still waiting to be sent; "none" = all collapsed.
  const [openId, setOpenId] = useState<string | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  // Watching a variant right here, when the surrounding page has no player of its own (the board's hand-off dialog).
  const [watching, setWatching] = useState<{ cutId: string; label: string } | null>(null);
  const withVa = status === "with_va";
  const readyToSend = status === "ready_to_post";

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
      // Already with the VA: the new cover reaches them straight away.
      if (withVa) {
        const saved = await saveVaCoverAction(videoId, up.path);
        if (saved && "error" in saved && saved.error) throw new Error(saved.error);
        toast.success("Cover updated.");
      }
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

  if (trials === null) {
    return <p className="px-1 py-3 text-xs text-ink-3">Loading variants…</p>;
  }

  const field =
    "rounded-md border border-line bg-raised px-2 py-1 text-xs placeholder:text-ink-3 focus:border-accent focus:outline-none";
  const cutKind = (t: TrialPost) => cuts.find((c) => c.id === t.cut_id)?.kind ?? "main";
  const waiting = trials.filter((t) => t.status === "planned");
  const activeId = openId ?? (waiting[0] ?? trials[0])?.id ?? "";
  const best = trials
    .filter((t) => variantState(t) === "trial_posted" && t.views !== null)
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))[0];

  return (
    <section className="mb-4 rounded-xl border border-line bg-card p-3">
      {watching ? <WatchDialog cutId={watching.cutId} label={watching.label} onClose={() => setWatching(null)} /> : null}
      {/* The hand-off. Ready to Post: this is where it's sent. With the VA: it can be edited live or taken back. */}
      {readyToSend || withVa ? (
        <div className="mb-3 space-y-2 rounded-lg border border-accent/30 bg-accent-ghost p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{withVa ? "With the VA" : "Send to the VA"}</h3>
            {withVa ? (
              <span className="text-[11px] text-ink-3">
                Anything you change here — captions, destinations, instructions, the cover — reaches them straight away.
              </span>
            ) : (
              <span className="text-[11px] text-ink-3">
                They get every variant below, each with its destination (trial reel or main feed) and caption.
              </span>
            )}
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (withVa && notes.trim() !== (vaNotes ?? "").trim()) void saveVaNotesAction(videoId, notes);
            }}
            rows={3}
            placeholder="Instructions for the VA — when to post, anything specific."
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
            {withVa ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(
                    () => takeBackFromVaAction(videoId),
                    () => {
                      toast.success("Taken back — it's in Ready to Post again.");
                      onSent?.();
                    }
                  )
                }
                className="ml-auto rounded-md border border-line bg-card px-3 py-1.5 text-[11px] text-ink-2 hover:border-warn hover:text-ink disabled:opacity-50"
              >
                Take it back from the VA
              </button>
            ) : (
              <button
                type="button"
                disabled={pending || uploadingCover}
                onClick={() =>
                  run(
                    () => sendToVaAction({ videoId, notes, coverPath }),
                    () => {
                      toast.success("Sent to the VA.");
                      onSent?.();
                    }
                  )
                }
                className="ml-auto rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hi disabled:opacity-50"
              >
                Send to the VA
              </button>
            )}
          </div>
        </div>
      ) : null}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Variants</h3>
        <span className="text-xs text-ink-3">{trials.length}</span>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-ink-3">
        Set each variant to a trial reel or the main feed and write its caption. Trials are posted by
        hand from the Instagram app; a main-feed post can be published straight from the VA&rsquo;s desk
        once Instagram is connected.
      </p>

      {best ? (
        <p className="mb-2 rounded-lg border border-line bg-raised px-3 py-1.5 text-xs text-ink-2">
          🏆 Best trial so far: <b className="text-ink">{best.label}</b> — {best.views?.toLocaleString()} views
          {best.likes !== null ? ` · ${best.likes.toLocaleString()} likes` : ""}
        </p>
      ) : null}

      {trials.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-ink-3">
          No cut on this video yet — variants appear here as soon as there&rsquo;s something to post.
        </div>
      ) : (
        <div className="space-y-2">
          {trials.map((t, i) => (
            <TrialRow
              key={t.id}
              open={activeId === t.id}
              onToggle={() => setOpenId(activeId === t.id ? "none" : t.id)}
              trial={t}
              index={i}
              isMain={cutKind(t) === "main" || t.cut_id === null}
              videoId={videoId}
              fallbackCaption={fallbackCaption}
              onWatch={onWatch ?? ((cutId) => setWatching({ cutId, label: t.label }))}
              pending={pending}
              run={run}
              field={field}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TrialRow({
  open,
  onToggle,
  trial: t,
  index,
  isMain,
  videoId,
  fallbackCaption,
  onWatch,
  pending,
  run,
  field,
}: {
  open: boolean;
  onToggle: () => void;
  trial: TrialPost;
  index: number;
  isMain: boolean;
  videoId: string;
  fallbackCaption: string;
  onWatch?: (cutId: string) => void;
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
  const toast = useToast();
  const coverInput = useRef<HTMLInputElement>(null);
  const [uploadingCover, setUploadingCover] = useState(false);

  async function uploadVariantCover(file: File) {
    if (file.size > 20 * 1024 * 1024) return toast.error("Keep the cover under 20 MB.");
    setUploadingCover(true);
    try {
      const up = await createFootageUploadUrlAction(videoId, file.name);
      if (!up?.ok) throw new Error(up?.error ?? "Could not start the upload.");
      const put = await fetch(up.signedUrl, { method: "PUT", body: file, headers: { "x-upsert": "true" } });
      if (!put.ok) throw new Error(`Upload failed (${put.status}).`);
      run(() => updateVariantAction(t.id, videoId, { coverPath: up.path }), () => toast.success("Cover saved for this variant."));
    } catch (e) {
      toast.error((e as Error).message);
    }
    setUploadingCover(false);
  }

  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  return (
    <div className={`rounded-lg border bg-raised/60 p-2.5 ${open ? "border-accent/50" : "border-line"}`}>
      <div className="flex items-center gap-2">
        <button
          title={t.winner ? "Winning hook" : "Mark as the winning hook"}
          onClick={() => run(() => markTrialWinnerAction(t.id, videoId))}
          disabled={pending || t.winner}
          className={`text-sm ${t.winner ? "" : "opacity-30 hover:opacity-80"}`}
        >
          🏆
        </button>
        {/* The name is also the open/close control. */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="min-w-0 flex-1 text-left text-sm font-medium hover:text-accent-hi"
        >
          <span className="block truncate">{isMain ? t.label : `Variant ${index + 1} — ${t.label}`}</span>
        </button>
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATE_TONE[variantState(t)]}`}>
          {STATE_LABELS[variantState(t)]}
        </span>
        <button
          title="Archive this trial"
          onClick={() => run(() => archiveTrialAction(t.id, videoId))}
          disabled={pending}
          className="shrink-0 text-ink-3 hover:text-red-400"
        >
          <IconTrash size={12} />
        </button>
      </div>

      {open ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {onWatch && t.cut_id ? (
            <button
              type="button"
              onClick={() => onWatch(t.cut_id as string)}
              className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-accent hover:text-ink"
            >
              Watch
            </button>
          ) : null}
          {variantState(t) === "scheduled_feed" ? (
            <span className="rounded-md bg-sky-500/15 px-2 py-1 text-[11px] text-sky-300">
              Scheduled for the feed — the VA can cancel or reschedule it.
            </span>
          ) : (
            // One status control, the same one the VA has. Any status can be changed to any other.
            <select
              value={variantState(t)}
              disabled={pending}
              onChange={(e) =>
                run(() => vaSetVariantStateAction(t.id, e.target.value as Exclude<VariantState, "scheduled_feed">, permalink || undefined))
              }
              aria-label="Status"
              className={`${field} min-w-0 flex-1`}
            >
              {SETTABLE_STATES.map((st) => (
                <option key={st} value={st}>
                  {STATE_LABELS[st]}
                </option>
              ))}
            </select>
          )}
        </div>
      ) : t.status === "planned" ? (
        // Collapsed: one line of the caption, so you can tell which is which.
        <button
          type="button"
          onClick={onToggle}
          className="mt-1.5 block w-full truncate text-left text-[11px] text-ink-3 hover:text-ink-2"
        >
          {t.caption?.trim() || (fallbackCaption ? `Using the shared caption: ${fallbackCaption}` : "No caption yet — click to write one")}
        </button>
      ) : null}

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
        <div className={`mt-2 space-y-2 ${open ? "" : "hidden"}`}>
          <textarea
            defaultValue={t.caption ?? ""}
            rows={7}
            placeholder={fallbackCaption ? "Caption — using the one from the box below unless you write one here" : "Caption for this variant"}
            onBlur={(e) => {
              if (e.target.value.trim() === (t.caption ?? "").trim()) return;
              run(() => updateVariantAction(t.id, videoId, { caption: e.target.value }));
            }}
            className={`${field} min-h-32 w-full resize-y text-sm leading-relaxed`}
          />
          <textarea
            defaultValue={t.notes ?? ""}
            rows={2}
            placeholder="Notes for the VA about this variant only (optional)"
            onBlur={(e) => {
              if (e.target.value.trim() === (t.notes ?? "").trim()) return;
              run(() => updateVariantAction(t.id, videoId, { notes: e.target.value }));
            }}
            className={`${field} w-full resize-y`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={uploadingCover || pending}
              onClick={() => coverInput.current?.click()}
              className="rounded-md border border-line px-2.5 py-1 text-[11px] text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
            >
              {uploadingCover ? "Uploading…" : t.cover_path ? "Replace this variant's cover" : "Upload a cover for this variant"}
            </button>
            {t.cover_path ? (
              <>
                <span className="text-[11px] text-ok">✓ Own cover set</span>
                <button
                  type="button"
                  onClick={() => run(() => updateVariantAction(t.id, videoId, { coverPath: null }))}
                  className="text-[11px] text-ink-3 underline hover:text-ink-2"
                >
                  Use the video&rsquo;s cover instead
                </button>
              </>
            ) : (
              <span className="text-[11px] text-ink-3">Uses the video&rsquo;s cover unless you set one.</span>
            )}
            <input
              ref={coverInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadVariantCover(f);
                e.target.value = "";
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex w-full items-center gap-1">
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
            </span>
          </div>
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

/** A variant's latest cut, playable in place — for pages that have no player of their own. */
function WatchDialog({ cutId, label, onClose }: { cutId: string; label: string; onClose: () => void }) {
  const [src, setSrc] = useState<Awaited<ReturnType<typeof getCutPlaybackAction>> | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    getCutPlaybackAction(cutId).then((r) => !cancelled && setSrc(r));
    return () => {
      cancelled = true;
    };
  }, [cutId]);
  return (
    <div
      role="dialog"
      aria-modal
      aria-label={`Watch ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-3 py-6"
    >
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-line bg-app p-3 shadow-2xl">
        <div className="mb-2 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{label}</p>
          <button type="button" onClick={onClose} aria-label="Close" className="px-2 text-lg leading-none text-ink-3 hover:text-ink">
            ×
          </button>
        </div>
        {src === undefined ? (
          <p className="py-10 text-center text-xs text-ink-3">Loading…</p>
        ) : src === null ? (
          <p className="py-10 text-center text-xs text-ink-3">There&rsquo;s no finished version of this cut to play yet.</p>
        ) : (
          <StreamPlayer playbackUrl={src.playbackUrl} poster={src.poster} className="max-h-[70vh] w-full rounded-lg bg-black" />
        )}
      </div>
    </div>
  );
}
