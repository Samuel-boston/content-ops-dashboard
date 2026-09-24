"use client";

import { useMemo, useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { TaskCard, TaskCardBody } from "@/components/board/TaskCard";
import { useToast } from "@/components/ui/Toast";
import { IconChevronRight, IconPlus, IconX } from "@/components/ui/icons";
import { moveVideoAction } from "@/app/board-actions";
import { opensBriefMenu, useBriefMenu } from "@/components/script/BriefMenu";
import { approveAction, approveCarouselCreativeAction } from "@/app/pipeline-actions";
import { bulkAssignAction, bulkSetStatusAction } from "@/app/calendar-actions";
import { displayName } from "@/lib/format";
import {
  ACTIVE_STATUSES,
  STATUS_COLOR,
  STATUS_LABELS,
  type BoardCard,
  type Profile,
  type VideoStatus,
} from "@/lib/types";

function Column({
  status,
  cards,
  onAdd,
  collapsed,
  onToggleCollapse,
  selected,
  onToggleSelect,
}: {
  status: VideoStatus;
  cards: BoardCard[];
  onAdd?: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  // Collapsed columns stay droppable, so you can still drag work into a stage
  // you aren't currently looking at.
  if (collapsed) {
    return (
      <div ref={setNodeRef} className="flex h-full w-11 shrink-0 flex-col items-center">
        <button
          type="button"
          onClick={onToggleCollapse}
          title={`Expand ${STATUS_LABELS[status]}`}
          className={`flex h-full w-full flex-col items-center gap-2 rounded-lg border py-3 transition ${
            isOver ? "border-accent bg-accent-ghost" : "border-line bg-card hover:bg-raised"
          }`}
        >
          <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[status] }} />
          <span className="text-xs tabular-nums text-ink-2">{cards.length}</span>
          <span
            className="whitespace-nowrap text-[11px] text-ink-3"
            style={{ writingMode: "vertical-rl" }}
          >
            {STATUS_LABELS[status]}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-[268px] shrink-0 flex-col">
      {/* Header + colour rail */}
      <div className="mb-2 shrink-0">
        <div className="flex items-center gap-2 px-1 pb-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: STATUS_COLOR[status] }}
          />
          <span className="truncate text-sm font-medium">{STATUS_LABELS[status]}</span>
          <span className="text-sm text-ink-3">{cards.length}</span>
          <span className="ml-auto flex items-center">
            {onAdd ? (
              <button
                type="button"
                onClick={onAdd}
                aria-label={`Add to ${STATUS_LABELS[status]}`}
                className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
              >
                <IconPlus size={14} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label={`Collapse ${STATUS_LABELS[status]}`}
              className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
            >
              <IconChevronRight size={14} />
            </button>
          </span>
        </div>
        <div className="h-0.5 rounded-full" style={{ background: STATUS_COLOR[status] }} />
      </div>

      <div
        ref={setNodeRef}
        className={`min-h-24 flex-1 space-y-2 overflow-y-auto rounded-lg p-1 transition ${
          isOver ? "bg-accent-ghost ring-1 ring-accent/40" : ""
        }`}
      >
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((c) => (
            <TaskCard
              key={c.id}
              card={c}
              selected={selected.has(c.id)}
              onToggleSelect={() => onToggleSelect(c.id)}
            />
          ))}
        </SortableContext>
        {cards.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-ink-3">Nothing here.</p>
        ) : null}
      </div>
    </div>
  );
}

export function Board({
  cards,
  onAdd,
  editors = [],
  compact = false,
  id = "content-board",
  columns = ACTIVE_STATUSES,
}: {
  cards: BoardCard[];
  onAdd?: (status: VideoStatus) => void;
  editors?: Pick<Profile, "id" | "full_name" | "email">[];
  /** Which status columns to show — a scoped board (Videos/Carousels/Scripting/Filming) shows a subset of the full pipeline. */
  columns?: VideoStatus[];
  /** Right-rail mode inside the video workspace — narrower gutters. */
  compact?: boolean;
  /**
   * Stable DndContext id. Without one, dnd-kit derives its
   * `aria-describedby` ids from a counter that starts fresh on the client,
   * so every card hydrates with a mismatched attribute.
   */
  id?: string;
}) {
  const toast = useToast();
  const [, startTransition] = useTrackedTransition();
  // Local copy so a drag lands instantly; the server revalidate reconciles it.
  const [items, setItems] = useState(cards);
  const briefMenu = useBriefMenu();
  const [dragId, setDragId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<VideoStatus>>(new Set());

  const toggleSelect = (cardId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });

  const toggleCollapse = (s: VideoStatus) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const runBulk = (fn: () => Promise<{ error?: string } | void>, ok: string) =>
    startTransition(async () => {
      const res = await fn();
      if (res && "error" in res && res.error) toast.error(res.error);
      else {
        toast.success(ok);
        setSelected(new Set());
      }
    });

  // Re-sync when the server sends a new list (render-phase, not an effect).
  const [seen, setSeen] = useState(cards);
  if (cards !== seen) {
    setSeen(cards);
    setItems(cards);
  }

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so clicking a card's title
    // still navigates instead of being swallowed by the drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const byStatus = useMemo(() => {
    const map = new Map<VideoStatus, BoardCard[]>();
    for (const s of columns) map.set(s, []);
    for (const c of items) map.get(c.status)?.push(c);
    return map;
  }, [items, columns]);

  const dragging = items.find((c) => c.id === dragId) ?? null;

  // A column's droppable area is one big rect that wraps every card in it, so
  // `closestCorners` alone frequently resolves `over` to the COLUMN rather
  // than the specific card under the pointer — one of its corners is often
  // "closest" simply because the rect is huge. That's why a drop always
  // landed at the bottom (Board.tsx's onDragEnd falls back to column.length
  // when there's no specific card). Prefer whichever card the pointer is
  // actually within; only fall back to corner-distance (column-level) when
  // the pointer isn't over any card, e.g. an empty column or its padding.
  const collisionDetection: CollisionDetection = (args) => {
    const hits = pointerWithin(args);
    const cardHit = hits.find((h) => !columns.includes(String(h.id) as VideoStatus));
    if (cardHit) return [cardHit];
    return closestCorners(args);
  };

  function onDragStart(e: DragStartEvent) {
    setDragId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setDragId(null);
    if (!over) return;

    const activeId = String(active.id);
    const card = items.find((c) => c.id === activeId);
    if (!card) return;

    // Dropped on itself — definitely a no-op, and `overCard` below would
    // otherwise resolve to the active card, which `column` has already
    // filtered out (index -1), falsely falling back to "end of column".
    const overId = String(over.id);
    if (overId === activeId) return;

    // `over` is either a column (dropped on empty space) or another card.
    const overCard = items.find((c) => c.id === overId);
    const toStatus = (overCard?.status ?? (overId as VideoStatus)) as VideoStatus;
    if (!columns.includes(toStatus)) return;

    // With the VA is where an approval lands, so dropping a card there from a
    // review stage IS the approval; from anywhere else it isn't a move.
    if (toStatus === "with_va" && card.status !== "with_va") {
      const approve =
        card.status === "needs_creatives"
          ? approveCarouselCreativeAction(card.id)
          : card.status === "in_review" || card.status === "final_review"
            ? approveAction(card.id)
            : null;
      if (!approve) toast.error("Approve it in review first — approving sends it to the VA.");
      else
        startTransition(async () => {
          const res = await approve;
          if (res && "error" in res && res.error) toast.error(res.error);
          else toast.success("Approved — it's on the VA's desk.");
        });
      return;
    }

    // `column` is the target list with the dragged card already removed —
    // `at` is an index INTO THIS FILTERED LIST, so any no-op check must
    // compare against this same list, never against the original
    // (unfiltered) one, which is a different length/order once the card's
    // own slot is missing from it.
    const column = (byStatus.get(toStatus) ?? []).filter((c) => c.id !== activeId);
    const index = overCard ? column.findIndex((c) => c.id === overCard.id) : column.length;
    const at = index === -1 ? column.length : index;

    const beforeId = at > 0 ? column[at - 1].id : null;
    const afterId = at < column.length ? column[at].id : null;

    // No-op: the drop resolves to the exact same neighbours the card already
    // has, in its own (unfiltered) column — i.e. nothing would actually move.
    if (card.status === toStatus) {
      const originalColumn = byStatus.get(toStatus) ?? [];
      const originalIndex = originalColumn.findIndex((c) => c.id === activeId);
      const originalBeforeId = originalIndex > 0 ? originalColumn[originalIndex - 1].id : null;
      const originalAfterId =
        originalIndex >= 0 && originalIndex < originalColumn.length - 1
          ? originalColumn[originalIndex + 1].id
          : null;
      if (originalBeforeId === beforeId && originalAfterId === afterId) return;
    }

    // Optimistic: drop it in place locally straight away.
    const next = items.filter((c) => c.id !== activeId);
    const insertAt = afterId ? next.findIndex((c) => c.id === afterId) : next.length;
    next.splice(insertAt === -1 ? next.length : insertAt, 0, { ...card, status: toStatus });
    setItems(next);

    startTransition(async () => {
      const res = await moveVideoAction({ id: activeId, toStatus, beforeId, afterId });
      if (res && "error" in res && res.error) {
        // RLS or a guard trigger refused the move — put the card back.
        toast.error(res.error);
        setItems(items);
      } else if (opensBriefMenu(toStatus) && card.status !== toStatus) {
        // Into Ready to Film or Ready to Edit: the editor brief pops up.
        briefMenu.open(activeId);
      }
    });
  }

  return (
    <DndContext
      id={id}
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragId(null)}
    >
      <div className={`flex h-full gap-3 overflow-x-auto ${compact ? "px-3 pb-3" : "pb-2"}`}>
        {columns.map((s) => (
          <Column
            key={s}
            status={s}
            cards={byStatus.get(s) ?? []}
            onAdd={onAdd ? () => onAdd(s) : undefined}
            collapsed={collapsed.has(s)}
            onToggleCollapse={() => toggleCollapse(s)}
            selected={selected}
            onToggleSelect={toggleSelect}
          />
        ))}
      </div>


      {/* Bulk bar — only appears once something is ticked. */}
      {selected.size > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-line bg-raised px-3 py-2 shadow-2xl">
            <span className="text-xs font-medium">
              {selected.size} selected
            </span>
            <select
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value as VideoStatus;
                e.target.value = "";
                if (v) runBulk(() => bulkSetStatusAction([...selected], v), `Moved ${selected.size}.`);
              }}
              className="rounded-md border border-line bg-card px-2 py-1 text-xs focus:outline-none"
            >
              <option value="">Move to…</option>
              {columns.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            {editors.length ? (
              <select
                defaultValue=""
                onChange={(e) => {
                  const v = e.target.value;
                  e.target.value = "";
                  if (v)
                    runBulk(
                      () => bulkAssignAction([...selected], v === "none" ? null : v),
                      `Assigned ${selected.size}.`
                    );
                }}
                className="rounded-md border border-line bg-card px-2 py-1 text-xs focus:outline-none"
              >
                <option value="">Assign to…</option>
                <option value="none">Unassign</option>
                {editors.map((ed) => (
                  <option key={ed.id} value={ed.id}>
                    {displayName(ed)}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              aria-label="Clear selection"
              className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
            >
              <IconX size={14} />
            </button>
          </div>
        </div>
      ) : null}

      {/* Rendered in a portal-free overlay so the card follows the cursor. */}
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2,0,0,1)" }}>
        {dragging ? (
          <div className="w-[268px] rotate-1 cursor-grabbing">
            <TaskCardBody card={dragging} dragging />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
