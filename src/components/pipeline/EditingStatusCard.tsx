import Link from "next/link";
import { ViewMaterialsButton } from "@/components/pipeline/ViewMaterials";
import { Avatar } from "@/components/ui/Avatar";
import { IconClock } from "@/components/ui/icons";
import { dayMonth, displayName } from "@/lib/format";
import type { Profile, Video } from "@/lib/types";

/**
 * What "Editing" opens onto for a manager: who has it and when it's due —
 * not the cuts/comments review, which is for once there's actually a cut to
 * look at. Checking in on a video that's still being worked on doesn't need
 * the review workspace, just the status and a way to see what the editor's
 * working from.
 */
export function EditingStatusCard({
  video,
  editor,
  briefVoiceUrl,
}: {
  video: Video;
  editor: Pick<Profile, "id" | "full_name" | "email"> | null;
  briefVoiceUrl: string | null;
}) {
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/board" className="text-sm text-ink-3 hover:text-ink">
          Board
        </Link>
        <span className="text-ink-3">/</span>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{video.title}</h1>
      </div>

      <div className="rounded-2xl border border-line bg-card p-5 text-center">
        <Avatar person={editor} size="lg" />
        <p className="mt-3 text-sm">
          {editor ? (
            <>
              <span className="font-medium">{displayName(editor)}</span> took this one
            </>
          ) : (
            "Being edited"
          )}
        </p>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-ink-3">
          <IconClock size={12} />
          {video.eta_at ? `Expected ${dayMonth(video.eta_at)}` : "No ETA given yet"}
        </p>
        <div className="mt-4 flex justify-center">
          <ViewMaterialsButton video={video} briefVoiceUrl={briefVoiceUrl} />
        </div>
      </div>
    </div>
  );
}
