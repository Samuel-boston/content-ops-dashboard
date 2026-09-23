"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  const [duration, setDuration] = useState(0);
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);

  // A returning reviewer shouldn't have to retype their name.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("guest-review-name");
      // Written straight to the input: it's external (browser) state arriving,
      // and the field is read back from `name` on change anyway.
      if (saved && nameRef.current) {
        nameRef.current.value = saved;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setName(saved);
      }
    } catch {
      /* private mode — fine */
    }
  }, []);
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
        try {
          if (name.trim()) window.localStorage.setItem("guest-review-name", name.trim());
        } catch {
          /* ignore */
        }
        setBody("");
        setSent(true);
        // Pull the new note into the list straight away.
        router.refresh();
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
            onLoaded={setDuration}
          />
        ) : (
          <div className="flex aspect-video items-center justify-center text-ink-3">
            <IconLayers size={22} />
          </div>
        )}
      </div>

      {/* Where the notes are, on the timeline — click one to jump there. */}
      {duration > 0 ? (
        <div className="relative h-6 rounded-lg bg-card">
          <div
            className="absolute inset-y-0 left-0 rounded-l-lg bg-accent/20"
            style={{ width: `${Math.min(100, (at / duration) * 100)}%` }}
          />
          {comments
            .filter((c) => c.t_start_seconds != null)
            .map((c) => (
              <button
                key={c.id}
                type="button"
                title={`${timecode(c.t_start_seconds as number)} — ${c.body.slice(0, 60)}`}
                onClick={() => playerRef.current?.seek(c.t_start_seconds as number)}
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-app bg-accent hover:scale-125"
                style={{ left: `${Math.min(100, ((c.t_start_seconds as number) / duration) * 100)}%` }}
              />
            ))}
        </div>
      ) : null}

      {view.video.brief ? (
        <p className="rounded-xl border border-line bg-card px-4 py-3 text-sm leading-relaxed text-ink-2">
          {view.video.brief}
        </p>
      ) : null}

      {/* Leave a note */}
      <div className="space-y-2 rounded-xl border border-line bg-card p-4">
        <h2 className="text-sm font-semibold">Leave a note</h2>
        <p className="text-[11px] text-ink-3">
          Pinned to {timecode(at)} — pause on the exact moment, then write. Your note lands on the timeline.
        </p>
        <input
          ref={nameRef}
          defaultValue={name}
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
                  <button
                    type="button"
                    onClick={() => playerRef.current?.seek(c.t_start_seconds as number)}
                    title="Jump to this moment"
                    className="rounded bg-raised px-1.5 py-0.5 font-mono hover:text-ink"
                  >
                    {timecode(c.t_start_seconds)}
                  </button>
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
