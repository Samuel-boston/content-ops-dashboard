"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { vaMarkVideoPostedAction, type PostedVideoRow, type PostingJobItem, type PostingTrialItem } from "@/app/posting-actions";
import { PostedVideoDialog, VideoWorkDialog } from "@/components/posting/PostingDialogs";
import { isToPost } from "@/lib/variant-state";

/**
 * The VA's board. One card per video — its hook variants live inside it and are
 * never split out. Two columns, the same as the client's flow:
 *
 *   To post   the video is with the VA: work through its variants
 *   Posted    marked posted — it's in the archive (drag here to finish a video)
 *
 * Opening a To-post card shows every variant on one page; opening a Posted card
 * shows performance and the button to post the best trial to the feed.
 */
interface VideoGroup {
  videoId: string;
  title: string;
  coverUrl: string | null;
  videoStatus: string;
  trials: PostingTrialItem[];
}

function groupUp(trials: PostingTrialItem[]): VideoGroup[] {
  const map = new Map<string, PostingTrialItem[]>();
  for (const t of trials) map.set(t.videoId, [...(map.get(t.videoId) ?? []), t]);
  return [...map.entries()].map(([videoId, list]) => ({
    videoId,
    title: list[0].videoTitle,
    coverUrl: list.find((t) => t.coverUrl)?.coverUrl ?? null,
    videoStatus: list[0].videoStatus,
    trials: list,
  }));
}

function Card({ g, draggable, onOpen }: { g: VideoGroup; draggable: boolean; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: g.videoId, disabled: !draggable });
  const total = g.trials.length;
  const posted = g.trials.filter((t) => !isToPost(t.state)).length;
  const best = g.trials
    .filter((t) => t.state === "trial_posted" && t.views !== null)
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))[0];
  const onFeed = g.trials.filter((t) => t.state === "feed_posted").length;
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }}
      className={`rounded-xl border border-line bg-card p-3 text-left transition hover:border-accent ${
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      } ${isDragging ? "relative z-20 opacity-90 shadow-2xl" : ""}`}
    >
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
            {total} variant{total === 1 ? "" : "s"}
            {draggable ? ` · ${posted} of ${total} posted` : ""}
          </p>
          {draggable ? (
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-hover">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${total ? (posted / total) * 100 : 0}%` }} />
            </div>
          ) : (
            <p className="mt-1 truncate text-[11px] text-ink-3">
              {onFeed ? `${onFeed} on the feed` : "Trials only"}
              {best ? ` · 🏆 ${best.label}: ${best.views?.toLocaleString()} views` : ""}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Column({
  id, label, color, blurb, groups, draggable, onOpen,
}: {
  id: string; label: string; color: string; blurb: string; groups: VideoGroup[]; draggable: boolean; onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`flex min-h-64 flex-col gap-2 rounded-xl border p-2 transition ${isOver ? "border-accent bg-accent-ghost/30" : "border-line bg-app"}`}>
      <div className="px-1 pt-0.5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
          <h2 className="text-sm font-medium">{label}</h2>
          <span className="text-xs text-ink-3">{groups.length}</span>
        </div>
        <div className="mt-1.5 h-0.5 rounded-full" style={{ background: color }} />
        <p className="mt-1 text-[10px] leading-snug text-ink-3">{blurb}</p>
      </div>
      {groups.length === 0 ? <p className="px-2 py-6 text-center text-xs text-ink-3">Nothing here.</p> : null}
      {groups.map((g) => (
        <Card key={g.videoId} g={g} draggable={draggable} onOpen={() => onOpen(g.videoId)} />
      ))}
    </div>
  );
}

export function PostingBoard({
  trials,
  jobs,
  archive,
  instagramConnected,
  clientName,
}: {
  trials: PostingTrialItem[];
  jobs: PostingJobItem[];
  archive: PostedVideoRow[];
  instagramConnected: boolean;
  clientName: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();
  const [tab, setTab] = useState<"board" | "archive">("board");
  const [query, setQuery] = useState("");
  const [openVideo, setOpenVideo] = useState<string | null>(null);
  const [openArchived, setOpenArchived] = useState<{ id: string; title: string } | null>(null);
  const [confirmPosted, setConfirmPosted] = useState<VideoGroup | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const groups = useMemo(() => groupUp(trials), [trials]);
  const q = query.trim().toLowerCase();
  const match = (title: string) => !q || title.toLowerCase().includes(q);
  const toPost = groups.filter((g) => g.videoStatus === "with_va" && match(g.title));
  const posted = groups.filter((g) => g.videoStatus !== "with_va" && match(g.title));
  const opened = groups.find((g) => g.videoId === openVideo) ?? null;

  function onDragEnd(e: DragEndEvent) {
    if (!e.over) return;
    const g = groups.find((x) => x.videoId === String(e.active.id));
    if (!g) return;
    if (String(e.over.id) === "posted" && g.videoStatus === "with_va") setConfirmPosted(g);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["board", "Board"],
            ["archive", `Archive · ${archive.length}`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${tab === k ? "bg-raised font-medium text-ink" : "text-ink-3 hover:text-ink-2"}`}
          >
            {label}
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search videos…"
          className="ml-auto w-56 rounded-md border border-line bg-raised px-2 py-1.5 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
      </div>

      {tab === "board" ? (
        <>
          <p className="text-[11px] text-ink-3">
            Open a video to work through all its hook variants in one place. When it&rsquo;s all posted, drag it to <b>Posted</b> — that
            moves it into the archive.
          </p>
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div className="grid gap-3 md:grid-cols-2">
              <Column id="to_post" label="To post" color="#f59e0b" blurb="With the VA — work through each video's variants." groups={toPost} draggable onOpen={setOpenVideo} />
              <Column id="posted" label="Posted" color="#34d399" blurb="Last 30 days. Open one for performance and to post the best trial to the feed." groups={posted} draggable={false} onOpen={setOpenVideo} />
            </div>
          </DndContext>
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-ink-3">
            Everything that&rsquo;s been posted. Open a video to add performance, see which trial is winning, and post it to the main feed.
          </p>
          {archive.filter((r) => match(r.title)).length === 0 ? (
            <p className="rounded-xl border border-line bg-card px-4 py-8 text-center text-sm text-ink-3">Nothing in the archive yet.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line bg-card">
              {archive
                .filter((r) => match(r.title))
                .map((r) => (
                  <button
                    key={r.videoId}
                    type="button"
                    onClick={() => setOpenArchived({ id: r.videoId, title: r.title })}
                    className="flex w-full flex-wrap items-center gap-3 border-b border-line px-4 py-2.5 text-left last:border-0 hover:bg-hover"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.title}</span>
                    <span className="text-[11px] text-ink-3">
                      {r.variants} variant{r.variants === 1 ? "" : "s"}
                      {r.trialsLive ? ` · ${r.trialsLive} trial` : ""}
                      {r.onFeed ? ` · ${r.onFeed} on feed` : ""}
                    </span>
                    {r.best ? (
                      <span className="text-[11px] text-ink-2">🏆 {r.best.label} · {r.best.views.toLocaleString()} views</span>
                    ) : null}
                    <span className="text-[11px] text-ink-3">
                      {r.postedAt ? new Date(r.postedAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : ""}
                    </span>
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      {opened && opened.videoStatus === "with_va" ? (
        <VideoWorkDialog
          trials={opened.trials}
          jobs={jobs}
          instagramConnected={instagramConnected}
          clientName={clientName}
          onClose={() => setOpenVideo(null)}
        />
      ) : null}
      {opened && opened.videoStatus !== "with_va" ? (
        <PostedVideoDialog videoId={opened.videoId} title={opened.title} clientName={clientName} onClose={() => setOpenVideo(null)} />
      ) : null}
      {openArchived ? (
        <PostedVideoDialog videoId={openArchived.id} title={openArchived.title} clientName={clientName} onClose={() => setOpenArchived(null)} />
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmPosted)}
        title="Mark as posted?"
        body="Marking as posted moves this into the archive, where you can add performance and post the best trial to the feed."
        confirmLabel="Proceed"
        cancelLabel="Go back"
        onCancel={() => setConfirmPosted(null)}
        onConfirm={() => {
          const g = confirmPosted;
          setConfirmPosted(null);
          if (!g) return;
          startTransition(async () => {
            const res = await vaMarkVideoPostedAction(g.videoId);
            if (res?.error) toast.error(res.error);
            else {
              toast.success("Posted — it's in the archive.");
              router.refresh();
            }
          });
        }}
      />
      {pending ? <span className="sr-only">Working…</span> : null}
    </div>
  );
}
