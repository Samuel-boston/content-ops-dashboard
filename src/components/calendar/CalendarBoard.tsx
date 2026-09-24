"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
  pointerWithin,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useToast } from "@/components/ui/Toast";
import { Avatar } from "@/components/ui/Avatar";
import { IconChevronRight, IconClock, IconLayers, IconX } from "@/components/ui/icons";
import { WeeklyCadence } from "@/components/calendar/WeeklyCadence";
import { setPostDateAction, type CadenceSlot, type CalendarVideo } from "@/app/calendar-actions";
import { buildMonthGrid, iso } from "@/lib/calendar";
import { dayMonth, displayName } from "@/lib/format";
import { STATUS_COLOR, STATUS_LABELS } from "@/lib/types";

/**
 * Stable colour per content pillar, so the same pillar reads the same across
 * the month. Hue only — saturation and lightness stay fixed so no pillar
 * shouts louder than another.
 */
function pillarHue(pillar: string): number {
  let h = 0;
  for (let i = 0; i < pillar.length; i += 1) h = (h * 31 + pillar.charCodeAt(i)) % 360;
  return h;
}

function pillarColour(v: CalendarVideo): string | null {
  const p = v.content_pillars?.[0];
  return p ? `hsl(${pillarHue(p)} 65% 60%)` : null;
}

/* ------------------------------------------------------------------ chip -- */

function VideoChip({
  video,
  colourBy,
  compact = false,
}: {
  video: CalendarVideo;
  colourBy: "stage" | "pillar";
  compact?: boolean;
}) {
  const colour =
    colourBy === "pillar" ? pillarColour(video) ?? STATUS_COLOR[video.status] : STATUS_COLOR[video.status];

  return (
    <span
      className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] leading-tight ${
        compact ? "" : "bg-card"
      }`}
      style={{ background: `color-mix(in srgb, ${colour} 14%, transparent)` }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colour }} />
      <span className="min-w-0 flex-1 truncate">{video.title}</span>
      {video.etaAfterPostDate ? (
        <span title="The editor's ETA lands after this post date" className="shrink-0 text-danger">
          <IconClock size={10} />
        </span>
      ) : null}
    </span>
  );
}

function DraggableChip(props: { video: CalendarVideo; colourBy: "stage" | "pillar" }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: props.video.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`cursor-grab touch-none ${isDragging ? "opacity-30" : ""}`}
    >
      <VideoChip {...props} />
    </div>
  );
}

/* ------------------------------------------------------------------ cell -- */

function DayCell({
  date,
  videos,
  colourBy,
  isToday,
  selected,
  onSelect,
}: {
  date: Date | null;
  videos: CalendarVideo[];
  colourBy: "stage" | "pillar";
  isToday: boolean;
  selected: boolean;
  onSelect: (d: string) => void;
}) {
  const key = date ? iso(date) : "";
  const { setNodeRef, isOver } = useDroppable({ id: key || "empty", disabled: !date });

  if (!date) return <div className="min-h-24 rounded-lg bg-panel/40" />;

  const clash = videos.some((v) => v.etaAfterPostDate);

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onSelect(key)}
      aria-label={`${date.getDate()} — ${videos.length} video${videos.length === 1 ? "" : "s"}`}
      className={`flex min-h-24 flex-col gap-1 rounded-lg border p-1.5 text-left transition ${
        isOver
          ? "border-accent bg-accent-ghost"
          : selected
            ? "border-accent bg-card"
            : "border-line bg-card hover:border-line-strong"
      }`}
    >
      <span className="flex items-center gap-1">
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] tabular-nums ${
            isToday ? "bg-accent font-semibold text-white" : "text-ink-3"
          }`}
        >
          {date.getDate()}
        </span>
        {clash ? <span className="h-1.5 w-1.5 rounded-full bg-danger" title="Schedule clash" /> : null}
        {videos.length > 2 ? (
          <span className="ml-auto text-[10px] text-ink-3">{videos.length}</span>
        ) : null}
      </span>

      <span className="flex flex-col gap-0.5">
        {videos.slice(0, 2).map((v) => (
          <DraggableChip key={v.id} video={v} colourBy={colourBy} />
        ))}
        {videos.length > 2 ? (
          <span className="px-1.5 text-[10px] text-ink-3">+{videos.length - 2} more</span>
        ) : null}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ main -- */

export function CalendarBoard({
  year,
  month,
  data,
  cadence,
  formats,
  platforms,
  canEdit,
}: {
  year: number;
  month: number;
  data: { scheduled: CalendarVideo[]; unscheduled: CalendarVideo[] };
  cadence: CadenceSlot[];
  formats: string[];
  platforms: string[];
  canEdit: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [, startTransition] = useTrackedTransition();

  // Everything on the calendar is finished or scheduled, so stage tells you nothing —
  // it filters by format and pillar instead, and colours by pillar.
  const colourBy = "pillar" as const;
  const [fmtFilter, setFmtFilter] = useState("");
  const [pillarFilter, setPillarFilter] = useState("");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  // Local copy so a drop lands instantly; the revalidate reconciles it.
  const [items, setItems] = useState(data);
  const [seen, setSeen] = useState(data);
  if (data !== seen) {
    setSeen(data);
    setItems(data);
  }

  const grid = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const todayISO = useMemo(() => iso(new Date()), []);

  const matches = (v: CalendarVideo) =>
    (!fmtFilter || v.formats?.includes(fmtFilter)) && (!pillarFilter || v.content_pillars?.includes(pillarFilter));
  const formatOptions = useMemo(
    () => [...new Set([...items.scheduled, ...items.unscheduled].flatMap((v) => v.formats ?? []))].sort(),
    [items]
  );
  const pillarOptions = useMemo(
    () => [...new Set([...items.scheduled, ...items.unscheduled].flatMap((v) => v.content_pillars ?? []))].sort(),
    [items]
  );

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarVideo[]>();
    for (const v of items.scheduled.filter(matches)) {
      if (!v.post_date) continue;
      const list = map.get(v.post_date) ?? [];
      list.push(v);
      map.set(v.post_date, list);
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.scheduled, fmtFilter, pillarFilter]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const dragging =
    [...items.scheduled, ...items.unscheduled].find((v) => v.id === dragId) ?? null;

  const pillars = useMemo(() => {
    const set = new Map<string, string>();
    for (const v of items.scheduled) {
      const p = v.content_pillars?.[0];
      if (p && !set.has(p)) set.set(p, `hsl(${pillarHue(p)} 65% 60%)`);
    }
    return [...set.entries()];
  }, [items.scheduled]);

  function onDragEnd(e: DragEndEvent) {
    setDragId(null);
    // View-only seats (the VA) can look but not reschedule.
    if (!canEdit) return;
    const id = String(e.active.id);
    if (!e.over) return;
    const target = String(e.over.id);
    const video = [...items.scheduled, ...items.unscheduled].find((v) => v.id === id);
    if (!video) return;

    const nextDate = target === "unscheduled" ? null : target;
    if (video.post_date === nextDate) return;

    // Optimistic move between the grid and the rail.
    const moved = { ...video, post_date: nextDate };
    setItems({
      scheduled: [
        ...items.scheduled.filter((v) => v.id !== id),
        ...(nextDate ? [moved] : []),
      ],
      unscheduled: [
        ...items.unscheduled.filter((v) => v.id !== id),
        ...(nextDate ? [] : [moved]),
      ],
    });

    startTransition(async () => {
      const res = await setPostDateAction(id, nextDate);
      if (res && "error" in res && res.error) {
        toast.error(res.error);
        setItems(items);
      } else {
        router.refresh();
      }
    });
  }

  const dayVideos = selectedDay ? byDay.get(selectedDay) ?? [] : [];

  return (
    <DndContext
      id="calendar"
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(e: DragStartEvent) => setDragId(String(e.active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragId(null)}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-3">
          {/* Colour legend */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={fmtFilter}
              onChange={(e) => setFmtFilter(e.target.value)}
              aria-label="Filter by format"
              className="rounded-md border border-line bg-raised px-2 py-1 text-[11px] focus:border-accent focus:outline-none"
            >
              <option value="">All formats</option>
              {formatOptions.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <select
              value={pillarFilter}
              onChange={(e) => setPillarFilter(e.target.value)}
              aria-label="Filter by pillar"
              className="rounded-md border border-line bg-raised px-2 py-1 text-[11px] focus:border-accent focus:outline-none"
            >
              <option value="">All pillars</option>
              {pillarOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            {pillars.length ? (
              <div className="flex flex-wrap items-center gap-2">
                {pillars.slice(0, 6).map(([name, colour]) => (
                  <span key={name} className="flex items-center gap-1 text-[11px] text-ink-3">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: colour }} />
                    {name}
                  </span>
                ))}
              </div>
            ) : null}
            {canEdit ? (
              <span className="ml-auto text-[11px] text-ink-3">Drag a video to move it</span>
            ) : null}
          </div>

          {/* Month grid */}
          <div className="grid grid-cols-7 gap-1">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <span key={d} className="px-1 pb-1 text-[10px] uppercase tracking-wider text-ink-3">
                {d}
              </span>
            ))}
            {grid.weeks.flat().map((date, i) => (
              <DayCell
                key={i}
                date={date}
                videos={date ? byDay.get(iso(date)) ?? [] : []}
                colourBy={colourBy}
                isToday={!!date && iso(date) === todayISO}
                selected={!!date && iso(date) === selectedDay}
                onSelect={setSelectedDay}
              />
            ))}
          </div>

          <WeeklyCadence
            slots={cadence}
            formats={formats}
            platforms={platforms}
            canEdit={canEdit}
          />
        </div>

        {/* Right rail: day detail, then unscheduled */}
        <div className="space-y-3">
          {selectedDay ? (
            <div className="rounded-xl border border-accent bg-card p-3">
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-sm font-semibold">
                  {new Date(`${selectedDay}T00:00:00`).toLocaleDateString("en-GB", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </h3>
                <button
                  type="button"
                  onClick={() => setSelectedDay(null)}
                  aria-label="Close day"
                  className="ml-auto rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
                >
                  <IconX size={13} />
                </button>
              </div>
              {dayVideos.length === 0 ? (
                <p className="py-4 text-center text-xs text-ink-3">
                  Nothing posting this day.
                  {canEdit ? " Drag something across from below." : ""}
                </p>
              ) : (
                <div className="space-y-2">
                  {dayVideos.map((v) => (
                    <VideoLink
                      key={v.id}
                      id={v.id}
                      canOpen={canEdit}
                      className="block rounded-lg border border-line bg-panel p-2.5 transition hover:border-line-strong"
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: STATUS_COLOR[v.status] }}
                        />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">
                          {v.title}
                        </span>
                        <IconChevronRight size={12} className="text-ink-3" />
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-ink-3">
                        <span>{STATUS_LABELS[v.status]}</span>
                        {v.platforms.length ? <span>{v.platforms.join(" · ")}</span> : null}
                        {v.assigned_editor ? (
                          <span className="flex items-center gap-1">
                            <Avatar person={v.assigned_editor} size="xs" />
                            {displayName(v.assigned_editor)}
                          </span>
                        ) : null}
                      </span>
                      {v.etaAfterPostDate ? (
                        <span className="mt-1.5 flex items-center gap-1 rounded bg-danger/10 px-1.5 py-1 text-[10px] text-danger">
                          <IconClock size={10} />
                          Editor&rsquo;s ETA is {dayMonth(v.eta_at)} — after this post date
                        </span>
                      ) : null}
                    </VideoLink>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          <UnscheduledRail videos={items.unscheduled.filter(matches)} colourBy={colourBy} canEdit={canEdit} />
        </div>
      </div>

      <DragOverlay dropAnimation={{ duration: 160, easing: "cubic-bezier(0.2,0,0,1)" }}>
        {dragging ? (
          <div className="w-52 cursor-grabbing rounded-md bg-raised p-0.5 shadow-2xl">
            <VideoChip video={dragging} colourBy={colourBy} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * A row that opens the video — unless the viewer can't. The VA sees the
 * calendar but has no access to the video page behind it, so for them it's
 * just a label rather than a link into a "not found".
 */
function VideoLink({
  id,
  canOpen,
  className,
  children,
}: {
  id: string;
  canOpen: boolean;
  className: string;
  children: React.ReactNode;
}) {
  if (!canOpen) return <div className={className}>{children}</div>;
  return (
    <Link href={`/videos/${id}`} className={className}>
      {children}
    </Link>
  );
}

/* ----------------------------------------------------------------- rail -- */

function UnscheduledRail({
  videos,
  colourBy,
  canEdit,
}: {
  videos: CalendarVideo[];
  colourBy: "stage" | "pillar";
  canEdit: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "unscheduled" });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border p-3 transition ${
        isOver ? "border-accent bg-accent-ghost" : "border-line bg-card"
      }`}
    >
      <div className="mb-1 flex items-baseline gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          No date yet
        </h3>
        <span className="text-[11px] text-ink-3">{videos.length}</span>
      </div>
      <p className="mb-2.5 text-[11px] leading-snug text-ink-3">
        Finished or nearly finished, waiting on a slot.
        {canEdit ? " Drag one onto a day." : ""}
      </p>

      {videos.length === 0 ? (
        <p className="py-6 text-center text-xs text-ink-3">
          <IconLayers size={16} className="mx-auto mb-1.5 opacity-50" />
          Everything&rsquo;s scheduled.
        </p>
      ) : (
        <div className="flex max-h-96 flex-col gap-1 overflow-y-auto">
          {videos.map((v) => (
            <div key={v.id} className="rounded-md hover:bg-panel">
              <DraggableChip video={v} colourBy={colourBy} />
              <VideoLink
                id={v.id}
                canOpen={canEdit}
                className="block px-1.5 pb-1 text-[10px] text-ink-3 hover:text-ink-2"
              >
                {STATUS_LABELS[v.status]}
                {v.assigned_editor ? ` · ${displayName(v.assigned_editor)}` : ""}
              </VideoLink>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
