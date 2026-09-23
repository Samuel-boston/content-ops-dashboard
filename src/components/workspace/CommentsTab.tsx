"use client";

import { useMemo, useState } from "react";
import { CommentCard } from "@/components/workspace/CommentCard";
import { IconComment } from "@/components/ui/icons";
import type { CutComment, Profile } from "@/lib/types";

type Filter = "all" | "open" | "resolved";

export function CommentsTab({
  comments,
  viewer,
  activeId,
  onSelect,
  onReply,
  onToggleResolved,
  onDelete,
  onVoiceTime,
}: {
  comments: CutComment[];
  viewer: Profile;
  activeId: string | null;
  onSelect: (c: CutComment) => void;
  onReply: (c: CutComment) => void;
  onToggleResolved: (c: CutComment) => void;
  onDelete: (c: CutComment) => void;
  onVoiceTime?: (comment: CutComment, t: number) => void;
  /** Kept for callers; no longer drives anything now the AI summary is gone. */
  videoId?: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const { roots, repliesByParent, counts } = useMemo(() => {
    const roots = comments.filter((c) => !c.parent_comment_id);
    const repliesByParent = new Map<string, CutComment[]>();
    for (const c of comments) {
      if (!c.parent_comment_id) continue;
      const list = repliesByParent.get(c.parent_comment_id) ?? [];
      list.push(c);
      repliesByParent.set(c.parent_comment_id, list);
    }
    const resolved = roots.filter((c) => c.resolved).length;
    return {
      roots,
      repliesByParent,
      counts: { all: roots.length, open: roots.length - resolved, resolved },
    };
  }, [comments]);

  const shown = roots
    .filter((c) => (filter === "open" ? !c.resolved : filter === "resolved" ? c.resolved : true))
    // Timeline order, with un-anchored notes last.
    .sort((a, b) => {
      const at = a.t_start_seconds ?? Number.MAX_SAFE_INTEGER;
      const bt = b.t_start_seconds ?? Number.MAX_SAFE_INTEGER;
      return at === bt ? a.created_at.localeCompare(b.created_at) : at - bt;
    });

  return (
    <div className="flex h-full flex-col">
      {/* Filter pills */}
      <div className="shrink-0 px-3 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-1 rounded-lg bg-panel p-1">
            {(
              [
                ["all", "All", counts.all],
                ["open", "Open", counts.open],
                ["resolved", "Resolved", counts.resolved],
              ] as const
            ).map(([key, label, n]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                aria-pressed={filter === key}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition ${
                  filter === key
                    ? "bg-raised text-ink shadow-sm"
                    : "text-ink-2 hover:text-ink"
                }`}
              >
                {label}
                <span className={filter === key ? "text-ink-2" : "text-ink-3"}>{n}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-4">
        {shown.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-ink-3">
            <IconComment size={22} />
            <p className="text-sm">
              {filter === "all" ? "No comments yet." : `Nothing ${filter}.`}
            </p>
            {filter === "all" ? (
              <p className="max-w-52 text-xs">
                Scrub to a moment and hit <span className="text-ink-2">Comment</span>, or draw
                straight on the frame.
              </p>
            ) : null}
          </div>
        ) : (
          shown.map((c) => (
            <CommentCard
              key={c.id}
              comment={c}
              replies={repliesByParent.get(c.id) ?? []}
              viewer={viewer}
              active={activeId === c.id}
              onSelect={onSelect}
              onReply={onReply}
              onToggleResolved={onToggleResolved}
              onDelete={onDelete}
              onVoiceTime={onVoiceTime}
            />
          ))
        )}
      </div>
    </div>
  );
}
