"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import {
  vaMarkTrialsPostedAction,
  vaSendBackAction,
  type PostingFeedMetrics,
  type PostingJobItem,
  type PostingTrialItem,
} from "@/app/posting-actions";
import { IconClock } from "@/components/ui/icons";
import { VariantDetail } from "@/components/posting/VariantDetail";
import { STATE_LABELS, STATE_TONE, isToPost } from "@/lib/variant-state";

/**
 * The VA's board — the same kind of board as the client's, for the posting half
 * of the pipeline. A card is one video; the column says where it is overall:
 *
 *   To post       some variant still has to be posted
 *   Scheduled     nothing left to do by hand — the rest is handed to Instagram
 *   Trials live   every variant is out as a trial reel; watching the numbers
 *   On the feed   at least one variant is on the main feed
 *
 * Every variant inside a video has its own status (see lib/variant-state.ts);
 * the column is only ever worked out from those, so it can never disagree.
 */
type ColumnId = "to_post" | "scheduled" | "trials_live" | "on_feed";

const COLUMNS: { id: ColumnId; label: string; color: string; blurb: string }[] = [
  { id: "to_post", label: "To post", color: "#f59e0b", blurb: "Something here still needs posting." },
  { id: "scheduled", label: "Scheduled", color: "#38bdf8", blurb: "Handed to Instagram — goes out by itself." },
  { id: "trials_live", label: "Trials live", color: "#34d399", blurb: "Out as trial reels. Bring the numbers back." },
  { id: "on_feed", label: "On the feed", color: "#a78bfa", blurb: "At least one is on the main feed." },
];

interface VideoGroup {
  videoId: string;
  title: string;
  coverUrl: string | null;
  trials: PostingTrialItem[];
  column: ColumnId;
  failed: PostingJobItem[];
  /** The live trial with the most views so far, from the numbers typed in. */
  best: PostingTrialItem | null;
}

function columnOf(trials: PostingTrialItem[]): ColumnId {
  if (trials.some((t) => isToPost(t.state))) return "to_post";
  if (trials.some((t) => t.state === "scheduled_feed")) return "scheduled";
  if (trials.some((t) => t.state === "feed_posted")) return "on_feed";
  return "trials_live";
}

function bestTrial(trials: PostingTrialItem[]): PostingTrialItem | null {
  const live = trials.filter((t) => (t.state === "trial_posted" || t.winner) && t.views !== null);
  return live.sort((a, b) => (b.views ?? 0) - (a.views ?? 0))[0] ?? null;
}

function groupUp(trials: PostingTrialItem[], jobs: PostingJobItem[]): VideoGroup[] {
  const map = new Map<string, PostingTrialItem[]>();
  for (const t of trials) map.set(t.videoId, [...(map.get(t.videoId) ?? []), t]);
  return [...map.entries()].map(([videoId, list]) => ({
    videoId,
    title: list[0].videoTitle,
    coverUrl: list.find((t) => t.coverUrl)?.coverUrl ?? null,
    trials: list,
    column: columnOf(list),
    failed: jobs.filter((j) => j.videoId === videoId && j.status === "failed"),
    best: bestTrial(list),
  }));
}

function CardBody({ g }: { g: VideoGroup }) {
  const counts = new Map<string, number>();
  for (const t of g.trials) counts.set(t.state, (counts.get(t.state) ?? 0) + 1);
  return (
    <div className="flex gap-3">
      {g.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={g.coverUrl} alt="" className="h-14 w-14 shrink-0 rounded-md object-cover" />
      ) : (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-raised text-lg text-ink-3">▶</span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{g.title}</p>
        <p className="mt-0.5 text-[11px] text-ink-3">
          {g.trials.length} variant{g.trials.length === 1 ? "" : "s"}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {[...counts.entries()].map(([state, n]) => (
            <span
              key={state}
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${STATE_TONE[state as keyof typeof STATE_TONE]}`}
            >
              {n} {STATE_LABELS[state as keyof typeof STATE_LABELS].toLowerCase()}
            </span>
          ))}
        </div>
        {g.best ? (
          <p className="mt-1 truncate text-[11px] text-ink-3">
            🏆 Best trial: {g.best.label} · {g.best.views?.toLocaleString()} views
          </p>
        ) : null}
        {g.failed.length ? <p className="mt-1 text-[11px] font-medium text-red-400">⚠ An Instagram post failed</p> : null}
      </div>
    </div>
  );
}

function BoardCard({ g, onOpen }: { g: VideoGroup; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: g.videoId });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }}
      className={`cursor-grab rounded-xl border border-line bg-card p-3 text-left transition hover:border-accent active:cursor-grabbing ${
        isDragging ? "relative z-20 opacity-90 shadow-2xl" : ""
      }`}
    >
      <CardBody g={g} />
    </div>
  );
}

function BoardColumn({
  col,
  groups,
  onOpen,
}: {
  col: (typeof COLUMNS)[number];
  groups: VideoGroup[];
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-64 flex-col gap-2 rounded-xl border p-2 transition ${isOver ? "border-accent bg-accent-ghost/30" : "border-line bg-app"}`}
    >
      <div className="px-1 pt-0.5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: col.color }} />
          <h2 className="text-sm font-medium">{col.label}</h2>
          <span className="text-xs text-ink-3">{groups.length}</span>
        </div>
        <div className="mt-1.5 h-0.5 rounded-full" style={{ background: col.color }} />
        <p className="mt-1 text-[10px] leading-snug text-ink-3">{col.blurb}</p>
      </div>
      {groups.length === 0 ? <p className="px-2 py-6 text-center text-xs text-ink-3">Nothing here.</p> : null}
      {groups.map((g) => (
        <BoardCard key={g.videoId} g={g} onOpen={() => onOpen(g.videoId)} />
      ))}
    </div>
  );
}

/** A video opened: its overview and variants, or one variant in detail. */
function VideoDialog({
  group,
  jobs,
  feedMetrics,
  instagramConnected,
  clientName,
  onClose,
}: {
  group: VideoGroup;
  jobs: PostingJobItem[];
  feedMetrics: Record<string, PostingFeedMetrics>;
  instagramConnected: boolean;
  clientName: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();
  const [variantId, setVariantId] = useState<string | null>(null);
  const [sendingBack, setSendingBack] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (variantId ? setVariantId(null) : onClose());
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, variantId]);

  const variant = group.trials.find((t) => t.id === variantId) ?? null;
  const withVa = group.trials.some((t) => t.videoStatus === "with_va");
  const notes = group.trials[0]?.notes ?? null;
  const ranked = group.trials
    .filter((t) => t.state === "trial_posted" && t.views !== null)
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  const queued = jobs.filter((j) => j.videoId === group.videoId);

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={group.title}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-3 py-6 sm:py-10"
    >
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl rounded-2xl border border-line bg-app p-4 shadow-2xl sm:p-5">
        <div className="mb-3 flex items-start gap-3">
          {group.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={group.coverUrl} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
          ) : null}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">{group.title}</h1>
            <p className="text-[11px] text-ink-3">
              {group.trials.length} hook variant{group.trials.length === 1 ? "" : "s"} · post them as trial reels first,
              then post the best one to the feed.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-lg leading-none text-ink-3 hover:bg-hover hover:text-ink"
          >
            ×
          </button>
        </div>

        {variant ? (
          <VariantDetail
            key={variant.id}
            trial={variant}
            feedMetrics={feedMetrics[variant.videoId] ?? null}
            instagramConnected={instagramConnected}
            clientName={clientName}
            onBack={() => setVariantId(null)}
          />
        ) : (
          <div className="space-y-4">
            {notes ? (
              <p className="whitespace-pre-wrap rounded-lg border border-line bg-card px-3 py-2 text-xs leading-relaxed text-ink-2">
                <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-ink-3">Instructions</span>
                {notes}
              </p>
            ) : null}

            {ranked.length ? (
              <div className="rounded-lg border border-line bg-card px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">How the trials are doing</p>
                <ol className="mt-1 space-y-0.5">
                  {ranked.map((t, i) => (
                    <li key={t.id} className="flex items-center gap-2 text-xs">
                      <span className="w-4 text-ink-3">{i + 1}.</span>
                      <span className="min-w-0 flex-1 truncate">{i === 0 ? "🏆 " : ""}{t.label}</span>
                      <span className="tabular-nums text-ink-2">{t.views?.toLocaleString()} views</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            {queued.length ? (
              <div className="space-y-1 rounded-lg border border-line bg-card px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Instagram queue</p>
                {queued.map((j) => (
                  <p key={j.id} className={`text-xs ${j.status === "failed" ? "text-red-400" : "text-ink-2"}`}>
                    <span className="mr-2 rounded bg-raised px-1.5 py-0.5 text-[10px] uppercase text-ink-3">{j.status}</span>
                    {j.scheduled_for
                      ? new Date(j.scheduled_for).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
                      : "unscheduled"}
                    {j.error ? ` — ${j.error}` : ""}
                  </p>
                ))}
              </div>
            ) : null}

            <div>
              <h2 className="mb-2 text-sm font-semibold">Hook variants</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.trials.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setVariantId(t.id)}
                    className="rounded-xl border border-line bg-card p-3 text-left transition hover:border-accent"
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {t.winner ? "🏆 " : ""}
                        {t.label}
                      </span>
                      <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATE_TONE[t.state]}`}>
                        {STATE_LABELS[t.state]}
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 min-h-8 text-[11px] leading-relaxed text-ink-3">
                      {t.caption || "No caption yet."}
                    </p>
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-3">
                      {t.state === "scheduled_feed" && t.jobAt ? (
                        <span className="inline-flex items-center gap-1">
                          <IconClock size={10} />
                          {new Date(t.jobAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                        </span>
                      ) : null}
                      {t.views !== null ? <span>{t.views.toLocaleString()} views</span> : null}
                      {t.likes !== null ? <span>{t.likes.toLocaleString()} likes</span> : null}
                      <span className="ml-auto text-accent-hi">Open →</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {withVa ? (
              sendingBack ? (
                <div className="rounded-xl border border-warn/40 bg-warn/5 p-3">
                  <p className="text-xs font-medium text-ink">Send this back to {clientName}&rsquo;s side — it goes back to Ready to Post.</p>
                  <p className="mt-0.5 text-[11px] text-ink-3">
                    It leaves this board (captions are kept) and anything scheduled is taken off the schedule. Say what needs
                    changing — it goes in the video&rsquo;s chat and they&rsquo;re notified.
                  </p>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    autoFocus
                    placeholder="e.g. The cover has a typo, and the caption mentions the wrong date."
                    className="mt-2 w-full resize-y rounded-md border border-line bg-raised px-2 py-1.5 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={pending || !reason.trim()}
                      onClick={() =>
                        startTransition(async () => {
                          const res = await vaSendBackAction(group.videoId, reason);
                          if (res?.error) toast.error(res.error);
                          else {
                            toast.success("Sent back — it's in Ready to Post on their board.");
                            onClose();
                            router.refresh();
                          }
                        })
                      }
                      className="rounded-lg bg-warn px-3 py-1.5 text-xs font-medium text-black hover:opacity-90 disabled:opacity-50"
                    >
                      Send it back
                    </button>
                    <button
                      type="button"
                      onClick={() => setSendingBack(false)}
                      className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:text-ink"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setSendingBack(true)}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-warn hover:text-ink"
                >
                  Something needs changing — send it back
                </button>
              )
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export function PostingBoard({
  trials,
  jobs,
  feedMetrics,
  instagramConnected,
  clientName,
}: {
  trials: PostingTrialItem[];
  jobs: PostingJobItem[];
  feedMetrics: Record<string, PostingFeedMetrics>;
  instagramConnected: boolean;
  clientName: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const [, startTransition] = useTrackedTransition();
  const [query, setQuery] = useState("");
  const [openVideo, setOpenVideo] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const groups = useMemo(() => groupUp(trials, jobs), [trials, jobs]);
  const q = query.trim().toLowerCase();
  const shown = groups.filter((g) => !q || g.title.toLowerCase().includes(q));
  const opened = groups.find((g) => g.videoId === openVideo) ?? null;

  function onDragEnd(e: DragEndEvent) {
    if (!e.over) return;
    const g = groups.find((x) => x.videoId === String(e.active.id));
    const to = String(e.over.id) as ColumnId;
    if (!g || g.column === to) return;
    if (to === "trials_live" && g.column === "to_post") {
      startTransition(async () => {
        const res = await vaMarkTrialsPostedAction(g.videoId);
        if (res?.error) {
          toast.error(res.error);
          setOpenVideo(g.videoId);
        } else {
          toast.success(
            `${res.marked} trial reel${res.marked === 1 ? "" : "s"} marked as posted${
              g.trials.some((t) => t.state === "to_feed") ? " — the feed post is still to do." : "."
            }`
          );
          router.refresh();
        }
      });
      return;
    }
    // Anything else depends on which variant — so open the video and do it there.
    toast.info("Which variant moved? Open it and set that variant's status — the card follows on its own.");
    setOpenVideo(g.videoId);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] text-ink-3">
          Click a card to open the video and its hook variants. Drag it to <b>Trials live</b> once its trial reels are
          posted.
        </p>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search videos…"
          className="ml-auto w-56 rounded-md border border-line bg-raised px-2 py-1.5 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => (
            <BoardColumn key={col.id} col={col} groups={shown.filter((g) => g.column === col.id)} onOpen={setOpenVideo} />
          ))}
        </div>
      </DndContext>
      {opened ? (
        <VideoDialog
          group={opened}
          jobs={jobs}
          feedMetrics={feedMetrics}
          instagramConnected={instagramConnected}
          clientName={clientName}
          onClose={() => setOpenVideo(null)}
        />
      ) : null}
    </div>
  );
}
