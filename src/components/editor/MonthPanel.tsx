"use client";

import { useClientName } from "@/components/ClientName";
import Link from "next/link";
import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useToast } from "@/components/ui/Toast";
import { Chip, PriorityPill } from "@/components/badges";
import { EtaBadge } from "@/components/pipeline/Eta";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconKanban,
  IconLink,
  IconList,
  IconFile,
} from "@/components/ui/icons";
import { setStatusAction } from "@/app/actions";
import {
  saveMonthBillingAction,
  type EditorMonth,
  type PricedVideo,
} from "@/app/editor-actions";
import { dayMonth, money } from "@/lib/format";
import { STATUS_COLOR, STATUS_LABELS, type VideoStatus } from "@/lib/types";

/**
 * Columns on an editor's board, in the order work moves through them.
 *
 * `ready_to_edit` is here because a video can be dropped back into the bay,
 * and `ready_to_post` / `posted` because an editor needs to see where their
 * finished work went — even though the guard trigger won't let them move
 * anything into those two.
 */
const COLUMNS: VideoStatus[] = [
  "ready_to_edit",
  "in_progress",
  "revisions",
  "awaiting_variants",
  "in_review",
  "ready_to_post",
  "posted",
];

/** The only stages an editor is allowed to move a video into (see the guard). */
const DROPPABLE: VideoStatus[] = ["ready_to_edit", "in_progress", "in_review", "awaiting_variants"];

/**
 * One month of an editor's work — the main unit of the whole dashboard.
 *
 * A month is what gets invoiced, so it's what the page is built out of: the
 * header carries the money and the payment link, and the body is every video
 * assigned in that month regardless of where it got to. There's no separate
 * "delivered" section, because splitting a month in two is exactly what makes
 * it impossible to answer "what am I owed for September".
 */
export function MonthPanel({
  data,
  currency,
  defaultOpen,
  defaultLink,
  overdueIds,
  editorId,
}: {
  data: EditorMonth;
  currency: string;
  defaultOpen: boolean;
  /** Carried from the last month that had one, so it's set once, not monthly. */
  defaultLink: string | null;
  overdueIds: Set<string>;
  /** Whose months these are — for the statement link. */
  editorId: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [view, setView] = useState<"list" | "board">("list");

  const openCount = data.videos.filter((v) => v.status !== "posted").length;
  // A video with no rate contributes nothing to the total, so the total is
  // wrong-but-silent unless the header says so.
  const unrated = data.videos.filter((v) => v.unrated).length;

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card">
      {/* ---- Month header: the money lives here ---- */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <span className="text-ink-3">
            {open ? <IconChevronDown size={15} /> : <IconChevronRight size={15} />}
          </span>
          <span className="text-base font-semibold">{data.label}</span>
          <span className="text-[11px] text-ink-3">
            {data.videos.length} video{data.videos.length === 1 ? "" : "s"}
            {openCount > 0 ? ` · ${openCount} still open` : " · all delivered"}
          </span>
        </button>

        <span className="flex items-center gap-2">
          {unrated > 0 ? (
            <span
              className="rounded-lg bg-warn/10 px-2.5 py-1.5 text-[11px] text-warn"
              title="These formats have no rate set, so they add nothing to the total"
            >
              {unrated} unpriced
            </span>
          ) : null}
          {data.paid ? (
            <span className="flex items-center gap-1.5 rounded-lg bg-ok/10 px-2.5 py-1.5 text-[11px] text-ok">
              <IconCheck size={12} />
              Paid {dayMonth(data.paidAt)}
            </span>
          ) : null}
          <span
            className={`rounded-lg px-3 py-1.5 text-base font-semibold tabular-nums ${
              data.paid ? "text-ink-2" : "bg-ok/10 text-ok"
            }`}
          >
            {money(data.totalCents, currency, { maximumFractionDigits: 2 })}
          </span>
        </span>
      </div>

      {open ? (
        <>
          <MonthBilling
            month={data.month}
            label={data.label}
            link={data.paymentLink}
            note={data.paymentNote}
            defaultLink={defaultLink}
            locked={data.paid}
          />

          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2">
            <Link
              href={`/team/${editorId}/statement?month=${data.month}`}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-2 transition hover:border-accent hover:text-ink"
            >
              <IconFile size={11} />
              Statement
            </Link>
            <span className="min-w-0 flex-1 text-[11px] text-ink-3">
              Everything assigned this month, whatever stage it reached. Prices in grey are
              estimates until the video posts.
            </span>
            <div className="ml-auto flex items-center gap-0.5 rounded-lg border border-line p-0.5">
              {([
                ["list", <IconList key="l" size={12} />],
                ["board", <IconKanban key="b" size={12} />],
              ] as const).map(([mode, icon]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setView(mode)}
                  aria-pressed={view === mode}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] capitalize transition ${
                    view === mode ? "bg-accent text-white" : "text-ink-3 hover:text-ink"
                  }`}
                >
                  {icon}
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {view === "list" ? (
            <ListView videos={data.videos} currency={currency} overdueIds={overdueIds} />
          ) : (
            <BoardView month={data.month} videos={data.videos} overdueIds={overdueIds} />
          )}
        </>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------- billing -- */

function MonthBilling({
  month,
  label,
  link,
  note,
  defaultLink,
  locked,
}: {
  month: string;
  label: string;
  link: string | null;
  note: string | null;
  defaultLink: string | null;
  /** Once the month is settled, changing where it should have been paid is noise. */
  locked: boolean;
}) {
  const clientName = useClientName();
  const toast = useToast();
  const router = useRouter();
  const [, startTransition] = useTrackedTransition();
  const [value, setValue] = useState(link ?? "");
  const [text, setText] = useState(note ?? "");
  const [dirty, setDirty] = useState(false);

  function save(nextLink = value, nextNote = text) {
    startTransition(async () => {
      const res = await saveMonthBillingAction({ month, link: nextLink, note: nextNote });
      if (res?.error) toast.error(res.error);
      else {
        setDirty(false);
        router.refresh();
      }
    });
  }

  if (locked) {
    return (
      <div className="border-t border-line bg-panel px-4 py-2.5">
        <span className="text-[11px] text-ink-3">
          {label} is settled{link ? ` — paid to ${link}` : ""}.
        </span>
      </div>
    );
  }

  return (
    <div className="border-t border-line bg-panel px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
          <IconLink size={11} />
          Pay this month to
        </span>
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setDirty(true);
          }}
          onBlur={() => dirty && save()}
          placeholder={defaultLink ?? "wise.com/pay/… or paypal.me/…"}
          className="min-w-48 flex-1 rounded-lg border border-line bg-raised px-2.5 py-1.5 text-xs placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
        {!value && defaultLink ? (
          <button
            type="button"
            onClick={() => {
              setValue(defaultLink);
              save(defaultLink);
            }}
            className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-2 hover:border-accent hover:text-ink"
          >
            Use last month&rsquo;s
          </button>
        ) : null}
        <span className="text-[10px] text-ink-3">{dirty ? "Unsaved" : value ? "Saved" : ""}</span>
      </div>
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        onBlur={() => dirty && save()}
        placeholder={`Invoice reference or a note for ${clientName} (optional)`}
        className="mt-1.5 w-full rounded-lg border border-line bg-raised px-2.5 py-1.5 text-xs placeholder:text-ink-3 focus:border-accent focus:outline-none"
      />
    </div>
  );
}

/* ----------------------------------------------------------------- list -- */

function ListView({
  videos,
  currency,
  overdueIds,
}: {
  videos: PricedVideo[];
  currency: string;
  overdueIds: Set<string>;
}) {
  const clientName = useClientName();
  // Grouped by stage so the list answers "where is everything" at a glance.
  const byStage = COLUMNS.map((s) => ({ status: s, rows: videos.filter((v) => v.status === s) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="border-t border-line">
      {byStage.map(({ status, rows }) => (
        <div key={status}>
          <div className="flex items-center gap-2 bg-panel/60 px-4 py-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: STATUS_COLOR[status] }}
            />
            <span className="text-[11px] font-medium text-ink-2">{STATUS_LABELS[status]}</span>
            <span className="text-[11px] text-ink-3">{rows.length}</span>
          </div>
          {rows.map((v) => (
            <Link
              key={v.id}
              href={`/videos/${v.id}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-2.5 last:border-0 hover:bg-hover/40"
            >
              <span className="min-w-[140px] flex-1 truncate text-sm font-medium">{v.title}</span>
              {v.priority !== "standard" ? <PriorityPill priority={v.priority} /> : null}
              <span className="hidden gap-1 sm:flex">
                {(v.formats ?? []).slice(0, 1).map((t) => (
                  <Chip key={t}>{t}</Chip>
                ))}
              </span>
              {v.eta_at && v.status !== "posted" ? (
                <EtaBadge etaAt={v.eta_at} stage={v.eta_stage} overdue={overdueIds.has(v.id)} />
              ) : null}
              {v.unrated ? (
                <span
                  className="w-16 shrink-0 text-right text-[10px] text-warn"
                  title={`No rate set for ${(v.formats ?? []).join(", ") || "this format"} — ask ${clientName}`}
                >
                  no rate
                </span>
              ) : (
                <span
                  className={`w-16 shrink-0 text-right text-[11px] tabular-nums ${
                    v.estimated ? "text-ink-3" : "text-ok"
                  }`}
                  title={
                    v.estimated
                      ? "Estimated at today's rates — fixed once it posts"
                      : "Locked in when it posted"
                  }
                >
                  {money(v.priceCents, currency, { maximumFractionDigits: 2 })}
                </span>
              )}
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- board -- */

function BoardView({
  month,
  videos,
  overdueIds,
}: {
  month: string;
  videos: PricedVideo[];
  overdueIds: Set<string>;
}) {
  const clientName = useClientName();
  const toast = useToast();
  const router = useRouter();
  const [, startTransition] = useTrackedTransition();
  const [dragId, setDragId] = useState<string | null>(null);

  // Local copy so a drop lands instantly; the revalidate reconciles it.
  const [items, setItems] = useState(videos);
  const [seen, setSeen] = useState(videos);
  if (videos !== seen) {
    setSeen(videos);
    setItems(videos);
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const dragging = items.find((v) => v.id === dragId) ?? null;

  function onDragEnd(e: DragEndEvent) {
    setDragId(null);
    if (!e.over) return;
    const id = String(e.active.id);
    const to = String(e.over.id) as VideoStatus;
    const video = items.find((v) => v.id === id);
    if (!video || video.status === to) return;

    if (!DROPPABLE.includes(to)) {
      toast.error(`Only ${clientName} can move something to ${STATUS_LABELS[to]}.`);
      return;
    }

    const before = items;
    setItems(items.map((v) => (v.id === id ? { ...v, status: to } : v)));
    startTransition(async () => {
      const res = await setStatusAction(id, to);
      if (res?.error) {
        toast.error(res.error);
        setItems(before);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <DndContext
      id={`editor-board-${month}`}
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(e: DragStartEvent) => setDragId(String(e.active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragId(null)}
    >
      <div className="no-scrollbar flex gap-2 overflow-x-auto border-t border-line p-3">
        {COLUMNS.map((status) => (
          <Column
            key={status}
            status={status}
            videos={items.filter((v) => v.status === status)}
            overdueIds={overdueIds}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 160, easing: "cubic-bezier(0.2,0,0,1)" }}>
        {dragging ? (
          <div className="w-56 cursor-grabbing rounded-lg bg-raised p-2 shadow-2xl">
            <span className="block truncate text-xs font-medium">{dragging.title}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  status,
  videos,
  overdueIds,
}: {
  status: VideoStatus;
  videos: PricedVideo[];
  overdueIds: Set<string>;
}) {
  const clientName = useClientName();
  const droppable = DROPPABLE.includes(status);
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: !droppable });

  return (
    <div
      ref={setNodeRef}
      className={`flex w-52 shrink-0 flex-col rounded-xl border p-2 transition ${
        isOver && droppable ? "border-accent bg-accent-ghost" : "border-line bg-panel"
      }`}
    >
      <div className="mb-2 flex items-center gap-1.5 px-1">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[status] }} />
        <span className="truncate text-[11px] font-medium text-ink-2">
          {STATUS_LABELS[status]}
        </span>
        <span className="ml-auto text-[11px] tabular-nums text-ink-3">{videos.length}</span>
        {!droppable ? (
          <span className="text-ink-3" title={`${clientName} moves videos into this column`}>
            <IconCheck size={9} />
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        {videos.map((v) => (
          <Card key={v.id} video={v} overdue={overdueIds.has(v.id)} />
        ))}
        {videos.length === 0 ? (
          <span className="px-1 py-3 text-center text-[10px] text-ink-3">—</span>
        ) : null}
      </div>
    </div>
  );
}

function Card({ video: v, overdue }: { video: PricedVideo; overdue: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: v.id });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`cursor-grab touch-none rounded-lg border border-line bg-card p-2 transition hover:border-line-strong ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      <Link
        href={`/videos/${v.id}`}
        onClick={(e) => e.stopPropagation()}
        className="block truncate text-xs font-medium hover:underline"
      >
        {v.title}
      </Link>
      <span className="mt-1 flex flex-wrap items-center gap-1.5">
        {v.priority !== "standard" ? <PriorityPill priority={v.priority} /> : null}
        {v.eta_at && v.status !== "posted" ? (
          <span className={`text-[10px] ${overdue ? "text-danger" : "text-ink-3"}`}>
            {dayMonth(v.eta_at)}
          </span>
        ) : null}
      </span>
    </div>
  );
}
