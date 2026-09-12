"use client";

import { VideoChat } from "@/components/VideoChat";
import { VideoActivityFeed } from "@/components/VideoActivityFeed";
import { VideoMetricsPanel } from "@/components/VideoMetricsPanel";
import type {
  Profile,
  VideoActivity,
  VideoMessage,
  VideoMetrics,
} from "@/lib/types";

/**
 * Discussion about the video as a whole — as opposed to the timeline comments,
 * which are always pinned to a moment in a specific cut. The activity trail and
 * post-publish metrics sit underneath, since both answer "what happened to this
 * video" rather than "what needs changing in the edit".
 */
export function ChatTab({
  videoId,
  viewer,
  messages,
  roster,
  activity,
  metrics,
  instagramConfigured,
}: {
  videoId: string;
  viewer: Profile;
  messages: VideoMessage[];
  roster: Pick<Profile, "id" | "full_name" | "email">[];
  activity: VideoActivity[];
  metrics: VideoMetrics | null;
  instagramConfigured: boolean;
}) {
  return (
    <div className="h-full space-y-5 overflow-y-auto px-3 py-3">
      <VideoChat videoId={videoId} viewer={viewer} messages={messages} roster={roster} />

      {metrics ? (
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Performance
          </h3>
          <VideoMetricsPanel
            videoId={videoId}
            metrics={metrics}
            canManage={viewer.role !== "editor"}
            instagramConfigured={instagramConfigured}
          />
        </section>
      ) : null}

      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          Activity
        </h3>
        <VideoActivityFeed items={activity} />
      </section>
    </div>
  );
}
