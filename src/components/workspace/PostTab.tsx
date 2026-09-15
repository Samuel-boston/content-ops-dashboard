"use client";

import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { IconCalendar, IconCheck, IconClock, IconSparkles } from "@/components/ui/icons";
import { schedulePostAction } from "@/app/publishing-actions";
import { generateCaptionAction } from "@/app/ai-actions";
import { TrialsPanel } from "@/components/workspace/TrialsPanel";
import { CHANNEL_LABELS, PUBLISH_CHANNELS, type PublishChannel } from "@/lib/types";
import type { PublishJob, Video } from "@/lib/types";

const IG_LIMIT = 2200;

/** Brand marks, drawn inline so nothing loads from a CDN. */
const CHANNEL_ICON: Record<PublishChannel, React.ReactNode> = {
  instagram: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  tiktok: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
      <path d="M16.5 3c.4 2.2 1.7 3.6 3.9 3.8v2.6c-1.4.1-2.7-.3-3.9-1v5.9c0 4.6-4.4 7.1-8 5.2-2.3-1.2-3.2-4.2-2.2-6.7.9-2.2 3.2-3.4 5.7-3v2.9c-.4-.1-.8-.2-1.2-.2-1.4 0-2.5 1.1-2.4 2.6.1 1.3 1.2 2.3 2.6 2.2 1.4-.1 2.3-1.2 2.3-2.6V3h3.2z" />
    </svg>
  ),
  linkedin: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
      <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3zM10 9h3.8v1.7h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V21h-4v-5.4c0-1.29-.02-2.95-1.8-2.95-1.8 0-2.08 1.4-2.08 2.85V21h-4z" />
    </svg>
  ),
  youtube: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
      <path d="M21.6 7.2a2.5 2.5 0 0 0-1.75-1.76C18.25 5 12 5 12 5s-6.25 0-7.85.44A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.75 1.76C5.75 19 12 19 12 19s6.25 0 7.85-.44a2.5 2.5 0 0 0 1.75-1.76A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15.2V8.8l5.2 3.2z" />
    </svg>
  ),
};

/**
 * Suggest a sensible posting slot: the video's planned post date at 18:15,
 * or tomorrow evening if there isn't one. This is a scheduling convenience,
 * not an engagement prediction — it's labelled "Suggested", not "Best".
 */
function suggestedSlot(video: Video): string {
  const base = video.post_date ? new Date(`${video.post_date}T18:15:00`) : new Date();
  if (!video.post_date) {
    base.setDate(base.getDate() + 1);
    base.setHours(18, 15, 0, 0);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}T${pad(
    base.getHours()
  )}:${pad(base.getMinutes())}`;
}

export function PostTab({
  video,
  cutId,
  jobs,
  canManage,
  instagramConfigured,
  durationSeconds,
}: {
  video: Video;
  cutId: string | null;
  jobs: PublishJob[];
  canManage: boolean;
  instagramConfigured: boolean;
  /** The active cut's duration, so the cover-frame picker can be bounded to it. */
  durationSeconds?: number | null;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTrackedTransition();
  const [caption, setCaption] = useState(
    [video.script_body, video.script_cta].filter(Boolean).join("\n\n")
  );
  const [captionPrompt, setCaptionPrompt] = useState("");
  const [channels, setChannels] = useState<PublishChannel[]>(["instagram"]);
  const [when, setWhen] = useState("");
  const [writing, setWriting] = useState(false);
  const [coverSeconds, setCoverSeconds] = useState(0);
  const [shareToFeed, setShareToFeed] = useState(true);

  const scheduled = jobs.filter((j) => j.status === "scheduled");

  function toggle(c: PublishChannel) {
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  if (!canManage) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-3">
        Scheduling is handled by the owner and admins.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-3 py-3">
      {/* Caption */}
      <div className="rounded-xl border border-line bg-card">
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={8}
          placeholder="Write the caption…"
          className="w-full resize-none bg-transparent px-3 py-3 text-sm leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none"
        />
        <div className="flex items-center gap-1.5 border-t border-line px-2 py-1.5">
          <input
            value={captionPrompt}
            onChange={(e) => setCaptionPrompt(e.target.value)}
            placeholder="Steer it — e.g. more playful, lead with the stat… (optional)"
            className="min-w-0 flex-1 rounded-md border border-line bg-raised px-2 py-1 text-[11px] placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            disabled={writing}
            onClick={() => {
              setWriting(true);
              startTransition(async () => {
                const res = await generateCaptionAction(video.id, captionPrompt);
                setWriting(false);
                if (res?.error) toast.error(res.error);
                else if (res?.ok) setCaption(res.caption);
              });
            }}
            title="Uses this video's script, its pillar/format, your SOP guide, and a couple of your own posted scripts as tone examples"
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-accent-hi disabled:opacity-50"
          >
            <IconSparkles size={12} />
            {writing ? "Writing…" : "Write caption"}
          </button>
          <button
            type="button"
            onClick={() => {
              const tags = video.content_pillars
                .concat(video.formats)
                .map((t) => `#${t.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`)
                .filter((t) => t.length > 1);
              if (!tags.length) {
                toast.info("Add pillars or formats on the Brief tab to generate tags.");
                return;
              }
              setCaption((c) => `${c.trimEnd()}\n\n${[...new Set(tags)].join(" ")}`);
            }}
            title="Append hashtags from this video's pillars and formats"
            className="flex items-center gap-1.5 rounded-md bg-accent-ghost px-2 py-1 text-[11px] text-accent-hi hover:bg-accent/25"
          >
            <IconSparkles size={12} />
            Tags
          </button>
          <span
            className={`ml-auto font-mono text-[11px] ${
              caption.length > IG_LIMIT ? "text-danger" : "text-ink-3"
            }`}
          >
            {caption.length} / {IG_LIMIT}
          </span>
        </div>
      </div>

      {/* Channels */}
      <h3 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
        Channels
      </h3>
      <div className="grid grid-cols-2 gap-2">
        {PUBLISH_CHANNELS.map((c) => {
          const on = channels.includes(c);
          const auto = c === "instagram" && instagramConfigured;
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
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{CHANNEL_LABELS[c]}</span>
                <span className="block truncate text-[10px] text-ink-3">
                  {auto ? "Auto-publish" : "Manual post"}
                </span>
              </span>
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
      {channels.some((c) => c !== "instagram") || !instagramConfigured ? (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          {instagramConfigured
            ? "Only Instagram publishes automatically. The rest are scheduled as reminders to post manually."
            : "No channel publishes automatically yet — connect Instagram in Settings → Integrations. Everything scheduled here still shows on the calendar."}
        </p>
      ) : null}

      {/* Cover & options — real Reels container settings, not scheduling metadata */}
      {channels.includes("instagram") ? (
        <>
          <h3 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Cover &amp; options
          </h3>
          <div className="space-y-2 rounded-xl border border-line bg-card p-2.5">
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
                seconds in{durationSeconds ? ` (of ${durationSeconds.toFixed(0)}s)` : ""} — picked
                from the video itself, no separate upload
              </span>
            </label>
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
        </>
      ) : null}

      {/* When */}
      <h3 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
        When
      </h3>
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
        <button
          type="button"
          onClick={() => setWhen(suggestedSlot(video))}
          title="Fill in this video's planned post date"
          className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-2 text-[11px] text-ink-2 hover:bg-hover hover:text-ink"
        >
          <IconClock size={12} />
          Suggested
        </button>
      </div>

      {scheduled.length ? (
        <div className="mt-4 space-y-1.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Already scheduled
          </h3>
          {scheduled.map((j) => (
            <div
              key={j.id}
              className="flex items-center gap-2 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[11px]"
            >
              <span className="text-ink-2">
                {j.scheduled_for
                  ? new Date(j.scheduled_for).toLocaleString("en-GB", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "No date"}
              </span>
              <span className="ml-auto text-ink-3">
                {(j.channels ?? []).map((c) => CHANNEL_LABELS[c as PublishChannel] ?? c).join(", ")}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        disabled={pending || !channels.length}
        onClick={() =>
          startTransition(async () => {
            const res = await schedulePostAction({
              videoId: video.id,
              cutId,
              caption,
              channels,
              scheduledFor: when || null,
              coverOffsetMs: Math.round(coverSeconds * 1000),
              shareToFeed,
            });
            if (res?.error) toast.error(res.error);
            else toast.success("Post scheduled.");
          })
        }
        className="mt-5 w-full rounded-xl bg-accent py-2.5 text-sm font-semibold text-white transition hover:bg-accent-hi disabled:opacity-50"
      >
        {pending ? "Scheduling…" : "Schedule post"}
      </button>

      {/* Hook trials — manual by nature (IG's API can't post or read trial
          reels), so it lives beside the automatic scheduler, not inside it. */}
      <TrialsPanel videoId={video.id} />
    </div>
  );
}
