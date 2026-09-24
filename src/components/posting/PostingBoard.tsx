"use client";
import type { PublishChannel } from "@/lib/types";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { vaMarkVideoPostedAction, type PostedVideoRow, type PostingJobItem, type PostingTrialItem } from "@/app/posting-actions";
import { VideoWorkDialog } from "@/components/posting/PostingDialogs";
import { VaArchive } from "@/components/posting/PostedArchiveList";
import { isToPost } from "@/lib/variant-state";

/**
 * The VA's board. One card per video — its hook variants live inside it and are
 * never split out. The board holds only videos that are with the VA. When one is
 * finished it is dragged to the "Posted" drop zone (or its Mark as posted button is
 * pressed): it leaves the board at once and is in the Archive tab — that is where
 * performance and "post to the main feed" live.
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

/** What a card looks like — shared by the card on the board and the copy that floats while it's dragged. */
function CardFace({ g, draggable }: { g: VideoGroup; draggable: boolean }) {
  const total = g.trials.length;
  const posted = g.trials.filter((t) => !isToPost(t.state)).length;
  return (
    <div className="flex gap-3">
      {g.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={g.coverUrl} alt="" draggable={false} className="h-14 w-14 shrink-0 rounded-md object-cover" />
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
            <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-300" style={{ width: `${total ? (posted / total) * 100 : 0}%` }} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Card({ g, leaving, onOpen }: { g: VideoGroup; leaving: boolean; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: g.videoId });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      // While it's being dragged, this stays put as a faint placeholder; the moving copy is the overlay.
      className={`cursor-grab touch-none select-none rounded-xl border border-line bg-card p-3 text-left transition-all duration-300 hover:border-accent active:cursor-grabbing ${
        isDragging ? "opacity-30" : ""
      } ${leaving ? "pointer-events-none scale-95 opacity-0" : ""}`}
    >
      <CardFace g={g} draggable />
    </div>
  );
}

function DropZone() {
  const { setNodeRef, isOver } = useDroppable({ id: "posted" });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-28 flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition-all duration-200 ${
        isOver ? "scale-[1.02] border-emerald-400 bg-emerald-500/10" : "border-line"
      }`}
    >
      <p className="text-sm font-medium">✓ Posted</p>
      <p className="mt-1 max-w-xs text-[11px] leading-snug text-ink-3">
        Drag a video here when everything in it is posted. It moves into the Archive tab.
      </p>
    </div>
  );
}

function Column({
  id, label, color, blurb, groups, leaving, onOpen,
}: {
  id: string; label: string; color: string; blurb: string; groups: VideoGroup[]; leaving: Set<string>; onOpen: (id: string) => void;
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
        <Card key={g.videoId} g={g} leaving={leaving.has(g.videoId)} onOpen={() => onOpen(g.videoId)} />
      ))}
    </div>
  );
}

export function PostingBoard({
  trials,
  jobs,
  archive,
  instagramConnected,
  publerConnected = false,
  channels,
  clientName,
}: {
  trials: PostingTrialItem[];
  jobs: PostingJobItem[];
  archive: PostedVideoRow[];
  instagramConnected: boolean;
  publerConnected?: boolean;
  channels?: PublishChannel[];
  clientName: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();
  const [tab, setTab] = useState<"board" | "archive">("board");
  const [query, setQuery] = useState("");
  const [openVideo, setOpenVideo] = useState<string | null>(null);
  const [confirmPosted, setConfirmPosted] = useState<VideoGroup | null>(null);
  // Videos just marked posted: gone from the board at once, without waiting for the refresh.
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const groups = useMemo(() => groupUp(trials), [trials]);
  const q = query.trim().toLowerCase();
  const match = (title: string) => !q || title.toLowerCase().includes(q);
  const toPost = groups.filter((g) => match(g.title) && !removed.has(g.videoId));
  const dragging = groups.find((g) => g.videoId === dragId) ?? null;
  const opened = groups.find((g) => g.videoId === openVideo) ?? null;

  function onDragEnd(e: DragEndEvent) {
    setDragId(null);
    if (!e.over) return;
    const g = groups.find((x) => x.videoId === String(e.active.id));
    if (!g) return;
    if (String(e.over.id) === "posted") setConfirmPosted(g);
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
        {tab === "board" ? (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search videos…"
          className="ml-auto w-56 rounded-md border border-line bg-raised px-2 py-1.5 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
        ) : null}
      </div>

      {tab === "board" ? (
        <>
          <p className="text-[11px] text-ink-3">
            Open a video to work through all its hook variants in one place. When it&rsquo;s all posted, drag it to <b>Posted</b> — it
            leaves this board and is in the Archive tab.
          </p>
          <DndContext
            sensors={sensors}
            onDragStart={(e: DragStartEvent) => setDragId(String(e.active.id))}
            onDragCancel={() => setDragId(null)}
            onDragEnd={onDragEnd}
          >
            <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Column id="to_post" label="To post" color="#f59e0b" blurb="With the VA — open a video to work through all its variants." groups={toPost} leaving={gone} onOpen={setOpenVideo} />
              <div className="md:pt-2">
                <DropZone />
              </div>
            </div>
            {/* The card that follows the pointer: lifted, slightly tilted, and it settles back if dropped nowhere. */}
            <DragOverlay dropAnimation={{ duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }}>
              {dragging ? (
                <div className="w-[min(28rem,80vw)] rotate-1 cursor-grabbing rounded-xl border border-accent bg-card p-3 shadow-2xl ring-1 ring-accent/40">
                  <CardFace g={dragging} draggable />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </>
      ) : (
        <VaArchive rows={archive} clientName={clientName} />
      )}

      {opened ? (
        <VideoWorkDialog
          trials={opened.trials}
          jobs={jobs}
          instagramConnected={instagramConnected}
          publerConnected={publerConnected}
          channels={channels}
          clientName={clientName}
          onClose={() => setOpenVideo(null)}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmPosted)}
        title="Mark as posted?"
        body="Marking as posted moves this into the archive, where you can add performance and post the best trial to the feed. Are you sure?"
        confirmLabel="Confirm"
        cancelLabel="Keep working"
        onCancel={() => setConfirmPosted(null)}
        onConfirm={() => {
          const g = confirmPosted;
          setConfirmPosted(null);
          if (!g) return;
          setGone((prev) => new Set(prev).add(g.videoId));
          // Fade it out first, then take it off the board.
          setTimeout(() => setRemoved((prev) => new Set(prev).add(g.videoId)), 320);
          startTransition(async () => {
            const res = await vaMarkVideoPostedAction(g.videoId);
            if (res?.error) {
              toast.error(res.error);
              for (const set of [setGone, setRemoved]) {
                set((prev) => {
                  const next = new Set(prev);
                  next.delete(g.videoId);
                  return next;
                });
              }
            } else {
              toast.success("Posted — it's in the Archive tab.");
              router.refresh();
            }
          });
        }}
      />
      {pending ? <span className="sr-only">Working…</span> : null}
    </div>
  );
}
