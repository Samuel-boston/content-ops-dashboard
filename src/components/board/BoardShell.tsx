"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Board } from "@/components/board/Board";
import { Avatar } from "@/components/ui/Avatar";
import {
  IconCalendar,
  IconChart,
  IconFilter,
  IconKanban,
  IconList,
  IconPlus,
  IconSearch,
  IconSort,
} from "@/components/ui/icons";
import { dayMonth, displayName, timecode } from "@/lib/format";
import {
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  STATUS_COLOR,
  STATUS_LABELS,
  type BoardCard,
  type Priority,
  type Profile,
  type VideoStatus,
} from "@/lib/types";

type View = "list" | "kanban";
type Sort = "manual" | "priority" | "deadline" | "title";

const SORTS: { key: Sort; label: string }[] = [
  { key: "manual", label: "Manual (drag order)" },
  { key: "priority", label: "Priority" },
  { key: "deadline", label: "Deadline" },
  { key: "title", label: "Title" },
];

export function BoardShell({
  cards,
  editors,
  headline,
  onNew,
  compact = false,
  columns,
}: {
  cards: BoardCard[];
  editors: Pick<Profile, "id" | "full_name" | "email">[];
  headline: string;
  onNew?: () => void;
  compact?: boolean;
  /** Which status columns the kanban view shows — a scoped board shows a subset. */
  columns?: VideoStatus[];
}) {
  const [view, setView] = useState<View>("kanban");
  const [query, setQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [menu, setMenu] = useState<"filter" | "sort" | null>(null);
  const [sort, setSort] = useState<Sort>("manual");
  const [priority, setPriority] = useState<Priority | "">("");
  const [editorId, setEditorId] = useState<string>("");

  const activeFilters = (priority ? 1 : 0) + (editorId ? 1 : 0);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = cards.filter((c) => {
      if (q && !c.title.toLowerCase().includes(q) && !(c.brief ?? "").toLowerCase().includes(q)) {
        return false;
      }
      if (priority && c.priority !== priority) return false;
      if (editorId && c.assigned_editor_id !== editorId) return false;
      return true;
    });
    if (sort === "priority") {
      out = [...out].sort((a, b) => b.priority_rank - a.priority_rank);
    } else if (sort === "deadline") {
      // Undated work sorts last rather than jumping to the front.
      out = [...out].sort((a, b) =>
        (a.post_date ?? "9999").localeCompare(b.post_date ?? "9999")
      );
    } else if (sort === "title") {
      out = [...out].sort((a, b) => a.title.localeCompare(b.title));
    }
    return out;
  }, [cards, query, priority, editorId, sort]);

  const totalOpen = cards.reduce((n, c) => n + c.open_comments, 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Workspace header */}
      <div className={`shrink-0 ${compact ? "px-3 pt-3" : ""}`}>
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card px-3 py-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/20 text-sm font-bold text-accent-hi">
            {headline.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
              Content Ops
            </p>
            <p className="truncate text-sm font-semibold">{headline}</p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Chip label="In flight" value={`${cards.length} videos`} />
            <Chip label="Open notes" value={`${totalOpen} comments`} />
            <Chip
              label="Needs script"
              value={`${cards.filter((c) => c.needs_script).length}`}
            />
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className={`flex shrink-0 flex-wrap items-center gap-1.5 py-3 ${compact ? "px-3" : ""}`}>
        {onNew ? (
          <button
            type="button"
            onClick={onNew}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hi"
          >
            New video
            <IconPlus size={13} />
          </button>
        ) : null}

        {showSearch ? (
          <div className="relative">
            <IconSearch
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
            />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => !query && setShowSearch(false)}
              placeholder="Search videos"
              className="w-44 rounded-lg border border-line bg-card py-1.5 pl-7 pr-2 text-xs placeholder:text-ink-3 focus:outline-none"
            />
          </div>
        ) : (
          <ToolbarButton icon={<IconSearch size={13} />} label="Search" onClick={() => setShowSearch(true)} />
        )}

        <div className="relative">
          <ToolbarButton
            icon={<IconFilter size={13} />}
            label="Filter"
            badge={activeFilters || undefined}
            onClick={() => setMenu(menu === "filter" ? null : "filter")}
          />
          {menu === "filter" ? (
            <>
              <span className="fixed inset-0 z-20" onClick={() => setMenu(null)} />
              <div className="absolute left-0 z-30 mt-1 w-56 space-y-3 rounded-lg border border-line bg-raised p-3 shadow-xl">
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                    Priority
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {PRIORITY_ORDER.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPriority(priority === p ? "" : p)}
                        className={`rounded-md px-2 py-1 text-[11px] ${
                          priority === p ? "bg-accent text-white" : "bg-card text-ink-2 hover:bg-hover"
                        }`}
                      >
                        {PRIORITY_LABELS[p]}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                    Editor
                  </p>
                  <select
                    value={editorId}
                    onChange={(e) => setEditorId(e.target.value)}
                    className="w-full rounded-md border border-line bg-card px-2 py-1.5 text-xs focus:outline-none"
                  >
                    <option value="">Anyone</option>
                    {editors.map((e) => (
                      <option key={e.id} value={e.id}>
                        {displayName(e)}
                      </option>
                    ))}
                  </select>
                </div>
                {activeFilters ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPriority("");
                      setEditorId("");
                    }}
                    className="w-full rounded-md border border-line py-1.5 text-[11px] text-ink-2 hover:bg-hover"
                  >
                    Clear filters
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </div>

        <div className="relative">
          <ToolbarButton
            icon={<IconSort size={13} />}
            label="Sort"
            badge={sort !== "manual" ? 1 : undefined}
            onClick={() => setMenu(menu === "sort" ? null : "sort")}
          />
          {menu === "sort" ? (
            <>
              <span className="fixed inset-0 z-20" onClick={() => setMenu(null)} />
              <div className="absolute left-0 z-30 mt-1 w-52 rounded-lg border border-line bg-raised py-1 shadow-xl">
                {SORTS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => {
                      setSort(s.key);
                      setMenu(null);
                    }}
                    className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-hover ${
                      sort === s.key ? "text-accent-hi" : "text-ink-2"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>

        {/* View switcher */}
        <div className="ml-auto flex items-center gap-0.5 rounded-lg border border-line p-0.5">
          <ViewButton active={view === "list"} onClick={() => setView("list")} title="List">
            <IconList size={14} />
          </ViewButton>
          <ViewButton active={view === "kanban"} onClick={() => setView("kanban")} title="Board">
            <IconKanban size={14} />
          </ViewButton>
          <ViewLink href="/calendar" title="Calendar">
            <IconCalendar size={14} />
          </ViewLink>
          <ViewLink href="/analytics" title="Analytics">
            <IconChart size={14} />
          </ViewLink>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {view === "kanban" ? (
          // Manual ordering is the drag order, so only the kanban honours it.
          <Board
            cards={shown}
            editors={editors}
            compact={compact}
            id={`board-${compact ? "rail" : "page"}`}
            columns={columns}
          />
        ) : (
          <ListView cards={shown} compact={compact} />
        )}
      </div>
    </div>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-lg bg-raised px-2.5 py-1.5">
      <span className="text-[10px] uppercase tracking-wider text-ink-3">{label}</span>
      <span className="text-xs font-medium text-ink-2">{value}</span>
    </span>
  );
}

function ToolbarButton({
  icon,
  label,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-ink-2 hover:bg-hover hover:text-ink"
    >
      {icon}
      {label}
      {badge ? (
        <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function ViewButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`rounded-md p-1.5 transition ${
        active ? "bg-accent text-white" : "text-ink-3 hover:bg-hover hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function ViewLink({
  href,
  title,
  children,
}: {
  href: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      title={title}
      aria-label={title}
      className="rounded-md p-1.5 text-ink-3 transition hover:bg-hover hover:text-ink"
    >
      {children}
    </Link>
  );
}

/** Dense table view — the same data, when a reviewer wants it all on one screen. */
function ListView({ cards, compact }: { cards: BoardCard[]; compact: boolean }) {
  return (
    <div className={`h-full overflow-auto ${compact ? "px-3 pb-3" : ""}`}>
      <table className="w-full min-w-160 border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10 bg-app">
          <tr className="text-left text-[10px] uppercase tracking-wider text-ink-3">
            <th className="px-2 pb-2 font-semibold">Video</th>
            <th className="px-2 pb-2 font-semibold">Stage</th>
            <th className="px-2 pb-2 font-semibold">Editor</th>
            <th className="px-2 pb-2 font-semibold">Deadline</th>
            <th className="px-2 pb-2 font-semibold">Priority</th>
            <th className="px-2 pb-2 text-right font-semibold">Notes</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c) => (
            <tr key={c.id} className="group">
              <td className="border-t border-line px-2 py-2">
                <Link href={`/videos/${c.id}`} className="flex items-center gap-2 hover:text-accent-hi">
                  {c.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.thumbnail_url} alt="" className="h-8 w-12 rounded object-cover" />
                  ) : (
                    <span className="h-8 w-12 rounded bg-raised" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.title}</span>
                    <span className="block text-[11px] text-ink-3">
                      {c.duration_seconds ? timecode(c.duration_seconds) : "—"}
                      {c.version ? ` · v${c.version}` : ""}
                    </span>
                  </span>
                </Link>
              </td>
              <td className="border-t border-line px-2 py-2">
                <span className="flex items-center gap-1.5 text-xs text-ink-2">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: STATUS_COLOR[c.status] }}
                  />
                  {STATUS_LABELS[c.status]}
                </span>
              </td>
              <td className="border-t border-line px-2 py-2">
                {c.assigned_editor ? (
                  <span className="flex items-center gap-1.5 text-xs text-ink-2">
                    <Avatar person={c.assigned_editor} size="sm" />
                    {displayName(c.assigned_editor)}
                  </span>
                ) : (
                  <span className="text-xs text-ink-3">Unassigned</span>
                )}
              </td>
              <td className="border-t border-line px-2 py-2 text-xs text-ink-2">
                {dayMonth(c.post_date)}
              </td>
              <td className="border-t border-line px-2 py-2 text-xs text-ink-2">
                {PRIORITY_LABELS[c.priority]}
              </td>
              <td className="border-t border-line px-2 py-2 text-right text-xs text-ink-2">
                {c.open_comments || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {cards.length === 0 ? (
        <p className="py-12 text-center text-sm text-ink-3">Nothing matches.</p>
      ) : null}
    </div>
  );
}
