import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { EtaBadge } from "@/components/pipeline/Eta";
import { PriorityPill } from "@/components/badges";
import { IconChevronRight, IconComment, IconFile, IconMic } from "@/components/ui/icons";
import { dayMonth, displayName } from "@/lib/format";
import { STATUS_COLOR, STATUS_LABELS, type VideoWithEditor } from "@/lib/types";

/**
 * One video in a list. Used by every stage page so a row means the same thing
 * everywhere — title, who has it, when it's due, what's on it.
 */
export function VideoRow({
  video,
  href,
  showStage = true,
  showEta = true,
  showScriptBadge = true,
  action,
}: {
  video: VideoWithEditor;
  href?: string;
  showStage?: boolean;
  showEta?: boolean;
  /** Every Ideation-stage video needs a script by definition — the badge is only informative once that's no longer universally true. */
  showScriptBadge?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="group flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 transition last:border-0 hover:bg-hover/40">
      <PriorityPill priority={video.priority} />

      <Link
        href={href ?? `/videos/${video.id}`}
        className="min-w-[160px] flex-1 truncate text-sm font-medium hover:text-accent-hi"
      >
        {video.title}
      </Link>

      <span className="flex shrink-0 items-center gap-2 text-[11px] text-ink-3">
        {video.needs_script && showScriptBadge ? (
          <span className="flex items-center gap-1 text-warn" title="Still needs a script">
            <IconFile size={11} />
            Script
          </span>
        ) : null}
        {video.brief_voice_path ? (
          <span className="flex items-center gap-1" title="Has a spoken brief">
            <IconMic size={11} />
          </span>
        ) : null}
        {video.needs_variants ? (
          <span className="flex items-center gap-1" title="Hook variants expected">
            <IconComment size={11} />
            {video.script_hooks?.length || 0} hooks
          </span>
        ) : null}
      </span>

      {showStage ? (
        <span
          className="flex shrink-0 items-center gap-1.5 text-[11px]"
          style={{ color: STATUS_COLOR[video.status] }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: STATUS_COLOR[video.status] }}
          />
          {STATUS_LABELS[video.status]}
        </span>
      ) : null}

      {video.assigned_editor ? (
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-2">
          <Avatar person={video.assigned_editor} size="sm" />
          <span className="hidden sm:inline">{displayName(video.assigned_editor)}</span>
        </span>
      ) : (
        <span className="shrink-0 text-[11px] text-ink-3">Unassigned</span>
      )}

      {showEta ? <EtaBadge etaAt={video.eta_at} stage={video.eta_stage} /> : null}

      <span className="shrink-0 text-[11px] text-ink-3">{dayMonth(video.post_date)}</span>

      {action ?? (
        <Link
          href={href ?? `/videos/${video.id}`}
          aria-label={`Open ${video.title}`}
          className="shrink-0 rounded-md p-1 text-ink-3 transition group-hover:text-ink-2"
        >
          <IconChevronRight size={14} />
        </Link>
      )}
    </div>
  );
}

export function VideoList({
  videos,
  empty,
  hrefFor,
  showStage,
}: {
  videos: VideoWithEditor[];
  empty: React.ReactNode;
  hrefFor?: (v: VideoWithEditor) => string;
  showStage?: boolean;
}) {
  if (!videos.length) {
    return (
      <div className="rounded-xl border border-line bg-card px-4 py-10 text-center text-sm text-ink-3">
        {empty}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-app">
      {videos.map((v) => (
        <VideoRow key={v.id} video={v} href={hrefFor?.(v)} showStage={showStage} />
      ))}
    </div>
  );
}
