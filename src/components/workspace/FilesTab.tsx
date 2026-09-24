"use client";

import { FinishedLinks } from "@/components/editor/FinishedLinks";
import { VideoFootage } from "@/components/VideoFootage";
import { VideoReferences } from "@/components/VideoReferences";
import { ShareLinks } from "@/components/workspace/ShareLinks";
import { CutManager } from "@/components/workspace/CutManager";
import type { CutComment, CutWithVersions, GuestLink, ReferenceItem, Video, VideoAsset } from "@/lib/types";

/**
 * Everything file-shaped for this video: the cut's version stack, hook
 * variants (each a full cut with its own versions and comments), raw footage,
 * and reference material.
 */
export function FilesTab({
  video,
  videoId,
  cuts,
  comments,
  activeCutId,
  onCutChange,
  assets,
  references,
  driveConfigured,
  streamConfigured,
  canEdit,
  guestLinks,
  canShare,
  canDeliverLinks,
}: {
  video: Pick<Video, "script_hooks">;
  videoId: string;
  cuts: CutWithVersions[];
  comments: CutComment[];
  activeCutId: string;
  onCutChange: (id: string) => void;
  assets: VideoAsset[];
  references: ReferenceItem[];
  driveConfigured: boolean;
  streamConfigured: boolean;
  canEdit: boolean;
  guestLinks: GuestLink[];
  canShare: boolean;
  /** The assigned editor can add finished-video links instead of uploading a file. */
  canDeliverLinks?: boolean;
}) {
  return (
    <div className="h-full space-y-5 overflow-y-auto px-3 py-3">
      {canDeliverLinks || assets.some((a) => a.kind === "delivery") ? (
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Finished video links
          </h3>
          <FinishedLinks videoId={videoId} assets={assets} canEdit={Boolean(canDeliverLinks)} />
        </section>
      ) : null}

      <CutManager
        video={video}
        videoId={videoId}
        cuts={cuts}
        comments={comments}
        activeCutId={activeCutId}
        onCutChange={onCutChange}
        streamConfigured={streamConfigured}
        canEdit={canEdit}
      />

      <ShareLinks videoId={videoId} links={guestLinks} canManage={canShare} />

      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          Raw footage
        </h3>
        <VideoFootage videoId={videoId} assets={assets} driveConfigured={driveConfigured} />
      </section>

      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          References
        </h3>
        <VideoReferences videoId={videoId} items={references} />
      </section>
    </div>
  );
}
