"use client";

import { useState } from "react";
import { IconCalendar, IconCheck, IconClock } from "@/components/ui/icons";
import { CHANNEL_LABELS, type PublishChannel } from "@/lib/types";

const IG_LIMIT = 2200;

/** Brand marks, drawn inline so nothing loads from a CDN. */
const CHANNEL_ICON: Partial<Record<PublishChannel, React.ReactNode>> = {
  instagram: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
};

export interface ComposerSubmit {
  caption: string;
  channels: PublishChannel[];
  /** ISO instant (already in absolute time), or null for "post now". */
  whenISO: string | null;
  coverOffsetMs: number;
  shareToFeed: boolean;
}

/** Local `YYYY-MM-DDTHH:mm` for a date — what a datetime-local input wants. */
export function localInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The one posting form — the same for the client and the VA. Caption, the
 * channels that are actually connected (nothing is listed until it's been
 * connected in Settings), cover and feed options for a Reel, and when to go
 * out: now, or a chosen time. What it does with the result is up to the caller.
 */
export function PostComposer({
  caption,
  onCaptionChange,
  connected,
  emptyHint,
  isVideo,
  durationSeconds,
  suggestedSlot,
  pending,
  nowOnly = false,
  coverEnabled = true,
  defaultChannels,
  onSubmit,
}: {
  caption: string;
  onCaptionChange: (v: string) => void;
  /** Channels that have been connected in Settings. */
  connected: PublishChannel[];
  /** What to say when there are none — differs for who can fix it. */
  emptyHint: React.ReactNode;
  /** Cover frame and feed options only mean something for a Reel. */
  isVideo: boolean;
  durationSeconds?: number | null;
  /** A local datetime-input value for the "Suggested" button, if there is one. */
  suggestedSlot?: string;
  pending: boolean;
  /** Only "post now" — no date and no cover/feed options. For trial reels. */
  nowOnly?: boolean;
  /** Whether the route in use honours a chosen cover frame (Publer picks its own). */
  coverEnabled?: boolean;
  /** Channels ticked to start with (default: every connected one). A long video starts on YouTube only. */
  defaultChannels?: PublishChannel[];
  onSubmit: (v: ComposerSubmit) => void;
}) {
  const [channels, setChannels] = useState<PublishChannel[]>(
    defaultChannels?.length ? defaultChannels.filter((c) => connected.includes(c)) : connected
  );
  const [when, setWhen] = useState("");
  const [coverSeconds, setCoverSeconds] = useState(0);
  const [shareToFeed, setShareToFeed] = useState(true);

  const active = channels.filter((c) => connected.includes(c));
  const toggle = (c: PublishChannel) =>
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  function submit(now: boolean) {
    onSubmit({
      caption,
      channels: active,
      // datetime-local has no time zone. Converting here, where the browser
      // knows the person's, is what makes "3pm" mean their 3pm.
      whenISO: now || !when ? null : new Date(when).toISOString(),
      coverOffsetMs: Math.round(coverSeconds * 1000),
      shareToFeed,
    });
  }

  return (
    <div className="space-y-4">
      {/* Caption */}
      <div className="rounded-xl border border-line bg-card">
        <textarea
          value={caption}
          onChange={(e) => onCaptionChange(e.target.value)}
          rows={7}
          placeholder="Write the caption…"
          className="w-full resize-none bg-transparent px-3 py-3 text-sm leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none"
        />
        <div className="flex items-center border-t border-line px-2 py-1.5">
          <span className={`ml-auto font-mono text-[11px] ${caption.length > IG_LIMIT ? "text-danger" : "text-ink-3"}`}>
            {caption.length} / {IG_LIMIT}
          </span>
        </div>
      </div>

      {/* Channels — only what's connected */}
      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Channels</h3>
        {connected.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong px-3 py-3 text-xs leading-relaxed text-ink-3">
            No channels connected. {emptyHint}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {connected.map((c) => {
              const on = channels.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggle(c)}
                  aria-pressed={on}
                  className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition ${
                    on ? "border-accent bg-accent-ghost" : "border-line bg-card hover:border-line-strong"
                  }`}
                >
                  <span className={on ? "text-accent-hi" : "text-ink-2"}>{CHANNEL_ICON[c]}</span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{CHANNEL_LABELS[c]}</span>
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      on ? "border-accent bg-accent text-white" : "border-line-strong"
                    }`}
                  >
                    {on ? <IconCheck size={9} /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Cover & options — real Reels container settings */}
      {isVideo && active.includes("instagram") && !nowOnly ? (
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Cover &amp; options</h3>
          <div className="space-y-2 rounded-xl border border-line bg-card p-2.5">
            {coverEnabled ? (
            <label className="flex items-center gap-2 text-xs text-ink-2">
              <span className="w-24 shrink-0 text-ink-3">Cover frame</span>
              <input
                type="number"
                min={0}
                max={durationSeconds ?? undefined}
                step={0.5}
                value={coverSeconds}
                onChange={(e) => setCoverSeconds(Math.max(0, Number(e.target.value) || 0))}
                className="w-20 rounded-md border border-line bg-raised px-2 py-1 text-xs text-ink focus:outline-none"
              />
              <span className="text-[11px] text-ink-3">
                seconds in{durationSeconds ? ` (of ${durationSeconds.toFixed(0)}s)` : ""}
              </span>
            </label>
            ) : null}
            <label className="flex items-center gap-2 text-xs text-ink-2">
              <input
                type="checkbox"
                checked={shareToFeed}
                onChange={(e) => setShareToFeed(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--color-accent)]"
              />
              Also share to the profile feed grid, not just Reels
            </label>
          </div>
        </div>
      ) : null}

      {/* When */}
      {nowOnly ? null : (
      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">When</h3>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <IconCalendar
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
            />
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="w-full rounded-lg border border-line bg-card py-2 pl-8 pr-2 text-xs text-ink [color-scheme:dark] focus:outline-none"
            />
          </div>
          {suggestedSlot ? (
            <button
              type="button"
              onClick={() => setWhen(suggestedSlot)}
              className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-2 text-[11px] text-ink-2 hover:bg-hover hover:text-ink"
            >
              <IconClock size={12} />
              Suggested
            </button>
          ) : null}
        </div>
      </div>
      )}

      <div className="flex flex-wrap gap-2">
        {nowOnly ? null : (
        <button
          type="button"
          disabled={pending || active.length === 0 || !when}
          onClick={() => submit(false)}
          className="flex-1 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hi disabled:opacity-50"
        >
          {pending ? "Working…" : "Schedule post"}
        </button>
        )}
        <button
          type="button"
          disabled={pending || active.length === 0}
          onClick={() => submit(true)}
          className={
            nowOnly
              ? "flex-1 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hi disabled:opacity-50"
              : "rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink-2 transition hover:border-accent hover:text-ink disabled:opacity-50"
          }
        >
          {nowOnly ? (pending ? "Posting…" : "Post trial reel now") : "Post now"}
        </button>
      </div>
    </div>
  );
}
