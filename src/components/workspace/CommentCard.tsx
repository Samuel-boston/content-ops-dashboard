"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import {
  IconCheck,
  IconComment,
  IconDraw,
  IconFile,
  IconLock,
  IconMic,
  IconReply,
  IconSection,
  IconTrash,
} from "@/components/ui/icons";
import { VoicePlayer } from "@/components/workspace/Voice";
import { displayName, fileSize, shortDate, timeRange } from "@/lib/format";
import type { CutComment, Profile } from "@/lib/types";

/** Role chip next to a name, mirroring Timeliner's GUEST tag. */
function RoleBadge({ role }: { role?: string | null }) {
  if (!role || role === "owner") return null;
  return (
    <span className="rounded bg-raised px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-3">
      {role === "admin" ? "Admin" : "Editor"}
    </span>
  );
}

export function CommentCard({
  comment,
  replies,
  viewer,
  active,
  onSelect,
  onReply,
  onToggleResolved,
  onDelete,
  onVoiceTime,
}: {
  comment: CutComment;
  replies: CutComment[];
  viewer: Profile;
  active: boolean;
  onSelect: (c: CutComment) => void;
  onReply: (c: CutComment) => void;
  onToggleResolved: (c: CutComment) => void;
  onDelete: (c: CutComment) => void;
  /** Drives replay of a drawing recorded while talking. */
  onVoiceTime?: (comment: CutComment, t: number) => void;
}) {
  const [showReplies, setShowReplies] = useState(false);
  const stamp = timeRange(comment.t_start_seconds, comment.t_end_seconds);
  const isRange = comment.t_end_seconds != null;
  const canDelete = comment.author_id === viewer.id || viewer.role !== "editor";

  return (
    <div
      onClick={() => onSelect(comment)}
      className={`cursor-pointer rounded-xl border bg-card px-3 py-2.5 transition ${
        active ? "border-accent shadow-[0_0_0_1px_var(--color-accent)]" : "border-line hover:border-line-strong"
      }`}
    >
      {/* Who + when */}
      <div className="flex items-center gap-2">
        <Avatar person={comment.author} size="md" />
        <span className="truncate text-sm font-medium">{displayName(comment.author)}</span>
        <RoleBadge role={comment.author?.role} />
        {stamp ? (
          <span className="ml-auto shrink-0 rounded bg-raised px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
            {stamp}
          </span>
        ) : null}
      </div>

      {comment.body ? (
        <p
          className={`mt-1.5 whitespace-pre-wrap break-words text-sm leading-snug ${
            comment.resolved ? "text-ink-3 line-through" : "text-ink"
          }`}
        >
          {comment.body}
        </p>
      ) : null}

      {comment.voice_url ? (
        <div className="mt-2">
          <VoicePlayer
            src={comment.voice_url}
            duration={comment.voice_duration_seconds}
            peaks={comment.voice_peaks}
            compact
            onTime={onVoiceTime ? (t) => onVoiceTime(comment, t) : undefined}
          />
        </div>
      ) : null}

      {comment.attachments?.length ? (
        <div className="mt-2 space-y-1.5">
          {/* A screen recording is the point of the comment, not a footnote to
              it — so video plays in place instead of being a link out. */}
          {comment.attachments
            .filter((a) => a.type.startsWith("video/") && a.signed_url)
            .map((a) => (
              <video
                key={a.path}
                src={a.signed_url}
                controls
                preload="metadata"
                onClick={(e) => e.stopPropagation()}
                className="max-h-64 w-full rounded-lg bg-black"
              />
            ))}

          <div className="flex flex-wrap gap-1.5">
            {comment.attachments
              .filter((a) => !(a.type.startsWith("video/") && a.signed_url))
              .map((a) => (
                <a
                  key={a.path}
                  href={a.signed_url ?? "#"}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1.5 rounded-md bg-raised px-2 py-1 text-[11px] text-ink-2 hover:bg-hover hover:text-ink"
                >
                  <IconFile size={11} />
                  <span className="max-w-36 truncate">{a.name}</span>
                  <span className="text-ink-3">{fileSize(a.size)}</span>
                </a>
              ))}
          </div>
        </div>
      ) : null}

      {comment.assignee ? (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-2">
          <span className="text-ink-3">for</span>
          <Avatar person={comment.assignee} size="xs" />
          {displayName(comment.assignee)}
        </div>
      ) : null}

      {/* Footer: what's attached, when, and the resolve toggle */}
      <div className="mt-2 flex items-center gap-2 text-ink-3">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onReply(comment);
          }}
          title="Reply"
          className="rounded p-0.5 hover:text-ink"
        >
          <IconReply size={13} />
        </button>
        {replies.length ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowReplies((v) => !v);
            }}
            className="flex items-center gap-1 text-[11px] hover:text-ink"
          >
            <IconComment size={12} />
            {replies.length} {replies.length === 1 ? "reply" : "replies"}
          </button>
        ) : null}

        {comment.visibility === "internal" ? <IconLock size={12} /> : null}
        {comment.drawing ? <IconDraw size={12} /> : null}
        {comment.voice_path ? <IconMic size={12} /> : null}
        {isRange ? <IconSection size={12} /> : null}

        <span className="ml-auto shrink-0 text-[11px]">{shortDate(comment.created_at)}</span>

        {canDelete ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(comment);
            }}
            title="Delete"
            className="rounded p-0.5 hover:text-danger"
          >
            <IconTrash size={13} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleResolved(comment);
          }}
          title={comment.resolved ? "Reopen" : "Mark resolved"}
          aria-pressed={comment.resolved}
          className={`rounded p-0.5 ${comment.resolved ? "text-ok" : "hover:text-ok"}`}
        >
          <IconCheck size={14} />
        </button>
      </div>

      {showReplies && replies.length ? (
        <div className="mt-2 space-y-2 border-l-2 border-line pl-2.5">
          {replies.map((r) => (
            <div key={r.id} className="animate-rise">
              <div className="flex items-center gap-1.5">
                <Avatar person={r.author} size="sm" />
                <span className="truncate text-xs font-medium">{displayName(r.author)}</span>
                <span className="ml-auto text-[10px] text-ink-3">{shortDate(r.created_at)}</span>
              </div>
              {r.body ? (
                <p className="mt-1 whitespace-pre-wrap break-words text-xs text-ink-2">{r.body}</p>
              ) : null}
              {r.voice_url ? (
                <div className="mt-1.5">
                  <VoicePlayer
                    src={r.voice_url}
                    duration={r.voice_duration_seconds}
                    peaks={r.voice_peaks}
                    compact
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
