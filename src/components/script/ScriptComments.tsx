"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { IconCheck, IconComment, IconTrash } from "@/components/ui/icons";
import {
  addScriptCommentAction,
  deleteScriptCommentAction,
  resolveScriptCommentAction,
} from "@/app/script-comment-actions";
import { displayName, shortDate } from "@/lib/format";
import type { Profile, ScriptComment } from "@/lib/types";

/**
 * The notes on one part of a script — a hook, the body, the call to action or
 * a carousel slide. Open notes sit right under the thing they're about, in
 * amber, so they can't be scrolled past; resolved ones fold away. Anyone on
 * the writing side (client, admin, copywriter) can add one, answer it or
 * mark it done.
 *
 * `quote` lets the caller pin a note to a specific run of words the reader
 * selected — it's kept with the note so it still makes sense after the
 * script is edited.
 */
export function ScriptComments({
  videoId,
  target,
  comments,
  viewer,
  quote,
  onQuoteUsed,
  label = "Comment",
  compact = false,
}: {
  videoId: string;
  target: string;
  comments: ScriptComment[];
  viewer: Pick<Profile, "id" | "role">;
  quote?: string | null;
  onQuoteUsed?: () => void;
  label?: string;
  compact?: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [pinnedQuote, setPinnedQuote] = useState<string | null>(null);

  const mine = comments.filter((c) => c.target === target);
  const open = mine.filter((c) => !c.resolved);
  const resolved = mine.filter((c) => c.resolved);
  const isManager = viewer.role === "owner" || viewer.role === "admin";

  function send() {
    const body = text.trim();
    if (!body) return;
    startTransition(async () => {
      const res = await addScriptCommentAction({
        videoId,
        target,
        quote: pinnedQuote ?? quote ?? null,
        body,
      });
      if (res?.error) toast.error(res.error);
      else {
        setText("");
        setComposing(false);
        setPinnedQuote(null);
        onQuoteUsed?.();
        router.refresh();
      }
    });
  }

  function toggle(c: ScriptComment) {
    startTransition(async () => {
      const res = await resolveScriptCommentAction(c.id, videoId, !c.resolved);
      if (res?.error) toast.error(res.error);
      else router.refresh();
    });
  }

  function remove(c: ScriptComment) {
    startTransition(async () => {
      const res = await deleteScriptCommentAction(c.id, videoId);
      if (res?.error) toast.error(res.error);
      else router.refresh();
    });
  }

  const note = (c: ScriptComment) => (
    <div
      key={c.id}
      className={`rounded-lg border px-2.5 py-2 text-xs ${
        c.resolved ? "border-line bg-panel text-ink-3" : "border-warn/40 bg-warn/5 text-ink"
      }`}
    >
      <div className="flex items-center gap-1.5 text-[10px] text-ink-3">
        <span className="font-medium text-ink-2">{displayName(c.author)}</span>
        <span>{shortDate(c.created_at)}</span>
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            disabled={pending}
            onClick={() => toggle(c)}
            title={c.resolved ? "Reopen" : "Mark as done"}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover ${
              c.resolved ? "text-ok" : "text-ink-3 hover:text-ok"
            }`}
          >
            <IconCheck size={10} />
            {c.resolved ? "Done" : "Mark done"}
          </button>
          {c.author_id === viewer.id || isManager ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => remove(c)}
              aria-label="Delete note"
              className="rounded p-0.5 text-ink-3 hover:text-danger"
            >
              <IconTrash size={10} />
            </button>
          ) : null}
        </span>
      </div>
      {c.quote ? (
        <p className="mt-1 border-l-2 border-line-strong pl-2 text-[11px] italic text-ink-3">
          &ldquo;{c.quote}&rdquo;
        </p>
      ) : null}
      <p className="mt-1 whitespace-pre-wrap leading-snug">{c.body}</p>
    </div>
  );

  return (
    <div className={compact ? "mt-1.5 space-y-1.5" : "mt-2 space-y-1.5"}>
      {open.map(note)}

      {resolved.length ? (
        <>
          <button
            type="button"
            onClick={() => setShowResolved((v) => !v)}
            className="text-[10px] text-ink-3 hover:text-ink-2"
          >
            {showResolved ? "Hide" : "Show"} {resolved.length} done
          </button>
          {showResolved ? resolved.map(note) : null}
        </>
      ) : null}

      {composing ? (
        <div className="space-y-1.5 rounded-lg border border-line bg-app p-2">
          {(pinnedQuote ?? quote) ? (
            <p className="border-l-2 border-accent pl-2 text-[11px] italic text-ink-3">
              &ldquo;{pinnedQuote ?? quote}&rdquo;
            </p>
          ) : null}
          <textarea
            autoFocus
            value={text}
            rows={2}
            onChange={(e) => setText(e.target.value)}
            placeholder="What needs to change, or what works?"
            className="w-full resize-none rounded-md border border-line bg-raised px-2 py-1.5 text-xs placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setComposing(false);
                setText("");
                setPinnedQuote(null);
              }}
              className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:bg-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending || !text.trim()}
              onClick={send}
              className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent-hi disabled:opacity-50"
            >
              {pending ? "Sending…" : "Add note"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setPinnedQuote(quote ?? null);
            setComposing(true);
          }}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-ink-3 hover:bg-hover hover:text-ink"
        >
          <IconComment size={11} />
          {quote ? `${label} on selection` : label}
        </button>
      )}
    </div>
  );
}
