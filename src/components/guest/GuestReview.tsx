"use client";

import { useRef, useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { StreamPlayer, type PlayerHandle } from "@/components/engine/StreamPlayer";
import { IconLayers, IconSend } from "@/components/ui/icons";
import { guestCommentAction, type GuestView } from "@/app/guest-actions";
import { shortDate, timecode } from "@/lib/format";

/** What someone outside the team sees: the cut, and a way to say something. */
export function GuestReview({ token, view }: { token: string; view: GuestView }) {
  const playerRef = useRef<PlayerHandle>(null);
  const [cutId, setCutId] = useState(view.cuts[0]?.id ?? "");
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [at, setAt] = useState(0);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTrackedTransition();

  const cut = view.cuts.find((c) => c.id === cutId) ?? view.cuts[0];
  const version = cut?.versions[0];
  const comments = view.comments.filter((c) => c.cut_id === cut?.id);

  function send() {
    setError(null);
    startTransition(async () => {
      const res = await guestCommentAction({
        token,
        cutId: cut.id,
        name,
        body,
        tStart: Math.round(at),
      });
      if (res?.error) setError(res.error);
      else {
        setBody("");
        setSent(true);
      }
    });
  }

  if (!cut) {
    return <p className="text-sm text-ink-3">Nothing to review here yet.</p>;
  }

  return (
    <div className="space-y-4">
      {view.cuts.length > 1 ? (
        <div className="no-scrollbar flex gap-1 overflow-x-auto">
          {view.cuts.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCutId(c.id)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs transition ${
                c.id === cut.id ? "bg-raised text-ink" : "text-ink-3 hover:text-ink-2"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="relative overflow-hidden rounded-xl bg-black">
        {version?.playback_url ? (
          <StreamPlayer
            ref={playerRef}
            playbackUrl={version.playback_url}
            poster={version.thumbnail_url}
            controls
            className="max-h-[65vh] w-full"
            onTimeUpdate={setAt}
          />
        ) : (
          <div className="flex aspect-video items-center justify-center text-ink-3">
            <IconLayers size={22} />
          </div>
        )}
      </div>

      {view.video.brief ? (
        <p className="rounded-xl border border-line bg-card px-4 py-3 text-sm leading-relaxed text-ink-2">
          {view.video.brief}
        </p>
      ) : null}

      {/* Leave a note */}
      <div className="space-y-2 rounded-xl border border-line bg-card p-4">
        <h2 className="text-sm font-semibold">Leave a note</h2>
        <p className="text-[11px] text-ink-3">
          Pinned to {timecode(at)} — pause where you mean, then write.
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className="w-full rounded-lg bg-raised px-3 py-2 text-sm placeholder:text-ink-3 focus:outline-none"
        />
        <textarea
          value={body}
          rows={3}
          onChange={(e) => {
            setBody(e.target.value);
            setSent(false);
          }}
          placeholder="What did you think?"
          className="w-full resize-none rounded-lg bg-raised px-3 py-2 text-sm placeholder:text-ink-3 focus:outline-none"
        />
        {error ? <p className="text-xs text-danger">{error}</p> : null}
        {sent ? <p className="text-xs text-ok">Sent — thanks.</p> : null}
        <button
          type="button"
          disabled={pending || !body.trim()}
          onClick={send}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hi disabled:opacity-40"
        >
          <IconSend size={13} />
          {pending ? "Sending…" : "Send note"}
        </button>
      </div>

      {comments.length ? (
        <div className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Notes</h2>
          {comments.map((c) => (
            <div key={c.id} className="rounded-xl border border-line bg-card px-3 py-2.5">
              <div className="flex items-center gap-2 text-[11px] text-ink-3">
                {c.t_start_seconds != null ? (
                  <span className="rounded bg-raised px-1.5 py-0.5 font-mono">
                    {timecode(c.t_start_seconds)}
                  </span>
                ) : null}
                <span className="ml-auto">{shortDate(c.created_at)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
