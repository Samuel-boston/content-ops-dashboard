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
  saveTrialMetricsAction,
  sendToVaAction,
  sendVariantToVaAction,
  takeBackFromVaAction,
  takeBackVariantAction,
  updateVariantAction,
} from "@/app/trial-actions";
import { createFootageUploadUrlAction } from "@/app/asset-actions";
import { IconTrash } from "@/components/ui/icons";
import { TRIAL_STATUS_LABELS, type TrialPost } from "@/lib/types";
import { CHOICE_LABELS, variantChoice, variantStateLabel, type VariantChoice } from "@/lib/variant-state";
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
  vaSentAt = null,
  withVa = false,
  hasCover = false,
  fallbackCaption = "",
  onWatch,
}: {
  videoId: string;
  vaNotes?: string | null;
  vaSentAt?: string | null;
  /** The video is in the "With the VA" stage. */
  withVa?: boolean;
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

  if (trials === null) {
    return <p className="px-1 py-3 text-xs text-ink-3">Loading variants…</p>;
  }

  const field =
    "rounded-md border border-line bg-raised px-2 py-1 text-xs placeholder:text-ink-3 focus:border-accent focus:outline-none";
  const cutKind = (t: TrialPost) => cuts.find((c) => c.id === t.cut_id)?.kind ?? "main";
  const waiting = trials.filter((t) => t.status === "planned" && !t.sent_to_va_at);
  const activeId = openId ?? (waiting[0] ?? trials[0])?.id ?? "";

  return (
    <section className="mb-4 rounded-xl border border-line bg-card p-3">
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
          placeholder="Notes for the VA — when to post, anything specific."
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
              run(
                () => sendToVaAction({ videoId, notes, coverPath, fallbackCaption }),
                () => toast.success(vaSentAt ? "Updated for the VA." : "Sent to the VA.")
              )
            }
            className="ml-auto rounded-md bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:bg-accent-hi disabled:opacity-50"
          >
            {waiting.length > 1 ? "Send all chosen variants" : withVa ? "Update what the VA sees" : "Send to the VA"}
          </button>
          {withVa ? (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  () => takeBackFromVaAction(videoId),
                  () => toast.success("Taken back from the VA — it's in Ready to Post again.")
                )
              }
              className="rounded-md border border-line bg-card px-3 py-1.5 text-[11px] text-ink-2 hover:border-warn hover:text-ink disabled:opacity-50"
            >
              Take it back from the VA
            </button>
          ) : null}
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Variants</h3>
        <span className="text-xs text-ink-3">{trials.length}</span>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-ink-3">
        Give each variant a destination and a caption, then send it. Trials post by hand from the
        Instagram app; a main-feed post can be published straight from the VA&rsquo;s desk once
        Instagram is connected.
      </p>

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
              onWatch={onWatch}
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
        {!open ? (
          <span className="shrink-0 rounded-md bg-raised px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">
            {t.post_as === "main" ? "Main feed" : "Trial"}
          </span>
        ) : null}
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${chip}`}>
          {t.status === "planned" && t.sent_to_va_at ? "With the VA" : t.status === "planned" ? TRIAL_STATUS_LABELS[t.status] : variantStateLabel(t)}
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
          {t.status === "planned" ? (
            <select
              value={t.post_as === "main" ? "main" : "trial"}
              disabled={pending}
              onChange={(e) =>
                run(() => updateVariantAction(t.id, videoId, { postAs: e.target.value as "trial" | "main" | "none" }))
              }
              aria-label="Post as"
              className={`${field} min-w-0 flex-1`}
            >
              <option value="trial">Trial reel</option>
              <option value="main">Post to main feed</option>
            </select>
          ) : t.status === "posted" || t.status === "promoted" ? (
            // Posted: record where it went. The owner can correct this the same way the VA does.
            <select
              value={variantChoice(t)}
              disabled={pending}
              onChange={(e) =>
                run(() => vaSetVariantStateAction(t.id, e.target.value as VariantChoice, permalink || undefined))
              }
              aria-label="Where it was posted"
              className={`${field} min-w-0 flex-1`}
            >
              <option value="trial">{CHOICE_LABELS.trial}</option>
              <option value="posted_main">{CHOICE_LABELS.posted_main}</option>
            </select>
          ) : (
            <span className="rounded-md bg-raised px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">
              {t.post_as === "main" ? "Main feed" : t.post_as === "trial" ? "Trial" : "—"}
            </span>
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
          <div className="flex flex-wrap items-center gap-2">
            {t.sent_to_va_at ? (
              <>
                <span className="text-[11px] text-ok">
                  ✓ With the VA since{" "}
                  {new Date(t.sent_to_va_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} — changes
                  here reach them straight away.
                </span>
                <button
                  onClick={() => run(() => takeBackVariantAction(t.id, videoId))}
                  disabled={pending}
                  className="ml-auto rounded-md border border-line px-2.5 py-1 text-[11px] text-ink-2 hover:border-warn hover:text-ink disabled:opacity-50"
                >
                  Take it back from the VA
                </button>
              </>
            ) : (
              <button
                onClick={() => run(() => sendVariantToVaAction(t.id, videoId, fallbackCaption))}
                disabled={pending}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hi disabled:opacity-50"
              >
                Send this one to the VA
              </button>
            )}
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
