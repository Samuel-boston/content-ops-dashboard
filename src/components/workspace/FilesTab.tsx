"use client";

import { VideoFootage } from "@/components/VideoFootage";
import { VideoReferences } from "@/components/VideoReferences";
import { ShareLinks } from "@/components/workspace/ShareLinks";
import { CutManager } from "@/components/workspace/CutManager";
import type { CutWithVersions, GuestLink, ReferenceItem, VideoAsset } from "@/lib/types";

/**
 * Everything file-shaped for this video: the cut's version stack, hook
 * variants (each a full cut with its own versions and comments), raw footage,
 * and reference material.
 */
export function FilesTab({
  videoId,
  cuts,
  activeCutId,
  onCutChange,
  assets,
  references,
  driveConfigured,
  streamConfigured,
  canEdit,
  guestLinks,
  canShare,
}: {
  videoId: string;
  cuts: CutWithVersions[];
  activeCutId: string;
  onCutChange: (id: string) => void;
  assets: VideoAsset[];
  references: ReferenceItem[];
  driveConfigured: boolean;
  streamConfigured: boolean;
  canEdit: boolean;
  guestLinks: GuestLink[];
  canShare: boolean;
}) {
  return (
    <div className="h-full space-y-5 overflow-y-auto px-3 py-3">
      <CutManager
        videoId={videoId}
        cuts={cuts}
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
