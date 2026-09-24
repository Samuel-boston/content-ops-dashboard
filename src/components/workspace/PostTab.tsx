"use client";

import { useRef, useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { schedulePostAction } from "@/app/publishing-actions";
import { savePostCaptionAction } from "@/app/trial-actions";
import { TrialsPanel } from "@/components/workspace/TrialsPanel";
import { PostComposer } from "@/components/posting/PostComposer";
import { isCarouselFormat } from "@/lib/taxonomy";
import { CHANNEL_LABELS, type PublishChannel } from "@/lib/types";
import type { PublishJob, Video } from "@/lib/types";

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
  variantsOnly = false,
  onWatch,
}: {
  video: Video;
  cutId: string | null;
  jobs: PublishJob[];
  canManage: boolean;
  instagramConfigured: boolean;
  /** The active cut's duration, so the cover-frame picker can be bounded to it. */
  durationSeconds?: number | null;
  /** Final Review: just the variants and the hand-off — no scheduling. */
  variantsOnly?: boolean;
  /** Open a variant's cut in the player. */
  onWatch?: (cutId: string) => void;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTrackedTransition();
  // The saved caption first; the script only as a starting point for a new one.
  const [caption, setCaption] = useState(
    video.post_caption ?? [video.script_body, video.script_cta].filter(Boolean).join("\n\n")
  );
  // Saved as you type (after a short pause), so it's on the VA's desk without any button to press.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function changeCaption(v: string) {
    setCaption(v);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void savePostCaptionAction(video.id, v), 700);
  }

  const scheduled = jobs.filter((j) => j.status === "scheduled");

  if (!canManage) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-3">
        Scheduling is handled by the owner and admins.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-3 py-3">
      {/* The hand-off to the VA comes first — it's the main thing to do with a
          finished video. Trials are manual by nature (IG's API can't post or
          read them), so this sits beside the automatic scheduler below. */}
      <TrialsPanel
        videoId={video.id}
        vaNotes={video.va_notes}
        status={video.status}
        hasCover={Boolean(video.cover_path)}
        fallbackCaption={caption}
        onWatch={onWatch}
      />

      {variantsOnly ? (
        <p className="text-[11px] leading-relaxed text-ink-3">
          Watch each variant, pick where it goes and write its caption. When you approve the
          variants they move to Ready to Post, where scheduling opens up.
        </p>
      ) : null}

      {variantsOnly ? null : (
        <>
          <PostComposer
            caption={caption}
            onCaptionChange={changeCaption}
            connected={instagramConfigured ? ["instagram"] : []}
            emptyHint={<>Connect one in Settings → Integrations and it shows up here.</>}
            isVideo={!isCarouselFormat(video.formats)}
            durationSeconds={durationSeconds}
            suggestedSlot={suggestedSlot(video)}
            pending={pending}
            onSubmit={(v) =>
              startTransition(async () => {
                const res = await schedulePostAction({
                  videoId: video.id,
                  cutId,
                  caption: v.caption,
                  channels: v.channels,
                  scheduledFor: v.whenISO,
                  coverOffsetMs: v.coverOffsetMs,
                  shareToFeed: v.shareToFeed,
                  publishNow: v.whenISO === null,
                });
                if (res?.error) toast.error(res.error);
                else toast.success(v.whenISO ? "Post scheduled." : "Posted.");
              })
            }
          />

          {scheduled.length ? (
            <div className="mt-4 space-y-1.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Already scheduled</h3>
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
        </>
      )}
    </div>
  );
}
