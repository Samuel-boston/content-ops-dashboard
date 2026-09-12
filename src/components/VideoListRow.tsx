import Link from "next/link";
import type { Profile, VideoWithEditor } from "@/lib/types";
import { isStalled } from "@/lib/types";
import { Chip, PriorityPill, StalledFlag, StatusBadge } from "@/components/badges";
import { AssignSelect } from "@/components/AssignSelect";
import { PrioritySelect } from "@/components/PrioritySelect";

interface Props {
  video: VideoWithEditor;
  viewer: Profile;
  editors: Pick<Profile, "id" | "full_name" | "email">[];
  showStatus?: boolean;
  showPriorityControl?: boolean;
}

export function VideoListRow({
  video,
  viewer,
  editors,
  showStatus = false,
  showPriorityControl = true,
}: Props) {
  const isManager = viewer.role === "owner" || viewer.role === "admin";
  const tags = [...video.platforms, ...video.formats, ...video.content_pillars].slice(0, 4);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3 last:border-b-0 hover:bg-hover/40">
      {showPriorityControl && isManager ? (
        <PrioritySelect videoId={video.id} current={video.priority} />
      ) : (
        <PriorityPill priority={video.priority} />
      )}

      <Link href={`/videos/${video.id}`} className="min-w-[160px] flex-1 font-medium hover:underline">
        {video.title}
        {video.needs_script ? (
          <span className="ml-2 text-[11px] text-warn">needs script</span>
        ) : null}
      </Link>

      {isStalled(video) ? <StalledFlag /> : null}
      {showStatus ? <StatusBadge status={video.status} /> : null}

      <div className="flex flex-wrap gap-1">
        {tags.map((t) => (
          <Chip key={t}>{t}</Chip>
        ))}
      </div>

      <AssignSelect
        videoId={video.id}
        videoTitle={video.title}
        currentEta={video.eta_at}
        currentEditorId={video.assigned_editor_id}
        currentEditorName={video.assigned_editor?.full_name ?? video.assigned_editor?.email ?? null}
        editors={editors}
        canAssignOthers={isManager}
        meId={viewer.id}
      />
    </div>
  );
}
