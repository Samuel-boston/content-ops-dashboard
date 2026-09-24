"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { StreamPlayer, type PlayerHandle } from "@/components/engine/StreamPlayer";
import { DrawLayer, DrawingView } from "@/components/workspace/DrawLayer";
import { Timeline, type Selection } from "@/components/workspace/Timeline";
import {
  IconChevronDown,
  IconComment,
  IconDownload,
  IconDraw,
  IconFullscreen,
  IconLayers,
  IconMic,
  IconMuted,
  IconPause,
  IconPlay,
  IconScreenRecord,
  IconSection,
  IconVolume,
  IconX,
} from "@/components/ui/icons";
import { frameLabel, timecode } from "@/lib/format";
import type { CutComment, CutVersion, CutWithVersions, Drawing, Video } from "@/lib/types";

const RATES = [0.5, 1, 1.5, 2];

export type Tool = "none" | "section" | "draw";

export function PlayerPane({
  video,
  cuts,
  activeCut,
  onCutChange,
  version,
  versions,
  onVersionChange,
  comments,
  activeId,
  current,
  duration,
  playing,
  selection,
  tool,
  drawing,
  composerOpen,
  onSeek,
  onDuration,
  onTime,
  onPlayState,
  onSelect,
  onTool,
  onDrawing,
  onOpenComposer,
  onStartVoice,
  onStartScreen,
  onPinClick,
  recordingSince,
  revealUpTo,
  headerActions,
  playerRef,
  backHref,
}: {
  video: Video;
  cuts: CutWithVersions[];
  activeCut: CutWithVersions;
  onCutChange: (cutId: string) => void;
  version: CutVersion | null;
  versions: CutVersion[];
  onVersionChange: (v: CutVersion) => void;
  comments: CutComment[];
  activeId: string | null;
  current: number;
  duration: number;
  playing: boolean;
  selection: Selection | null;
  tool: Tool;
  drawing: Drawing | null;
  composerOpen: boolean;
  onSeek: (t: number) => void;
  onDuration: (d: number) => void;
  onTime: (t: number) => void;
  onPlayState: (p: boolean) => void;
  onSelect: (s: Selection | null) => void;
  onTool: (t: Tool) => void;
  onDrawing: (d: Drawing | null) => void;
  onOpenComposer: () => void;
  onStartVoice: () => void;
  onStartScreen: () => void;
  /** Attaching now lives in the comment box only; kept so callers needn't change. */
  onAttach?: () => void;
  onPinClick: (c: CutComment) => void;
  /** Set while a voice note records, so strokes get timestamped. */
  recordingSince?: number | null;
  /** Playback position of the active comment's voice note, for replay. */
  revealUpTo?: number;
  /** Stage- and role-specific actions (see StageActions). */
  headerActions?: React.ReactNode;
  playerRef: React.RefObject<PlayerHandle | null>;
  backHref: string;
}) {
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [menu, setMenu] = useState<"version" | "cut" | null>(null);
  // Side-by-side comparison against an older cut of the same clip.
  const [compareWith, setCompareWith] = useState<CutVersion | null>(null);
  const [sync, setSync] = useState(true);
  const compareRef = useRef<PlayerHandle>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  // Keep the comparison clip on the same frame as the primary while synced.
  function handleTime(t: number) {
    onTime(t);
    if (compareWith && sync) {
      const other = compareRef.current;
      if (other && Math.abs(other.currentTime() - t) > 0.35) other.seek(t);
    }
  }

  // The saved drawing to show over the frame: the active comment's, if it has
  // one and the playhead is near its timecode.
  const activeComment = comments.find((c) => c.id === activeId);
  const showSaved =
    activeComment?.drawing &&
    activeComment.t_start_seconds != null &&
    Math.abs(current - activeComment.t_start_seconds) < 1.5;

  function toggleFullscreen() {
    const el = frameRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
        <Link
          href={backHref}
          aria-label="Back to board"
          className="rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-ink"
        >
          <IconX size={16} />
        </Link>
        {version?.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={version.thumbnail_url}
            alt=""
            className="h-7 w-10 shrink-0 rounded object-cover"
          />
        ) : (
          <span className="h-7 w-10 shrink-0 rounded bg-raised" />
        )}
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{video.title}</h1>

        {/* Version badge doubles as the version picker */}
        {versions.length ? (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenu(menu === "version" ? null : "version")}
              className="flex items-center gap-1 rounded-md bg-raised px-2 py-1 text-[11px] font-semibold text-ink-2 hover:bg-hover hover:text-ink"
            >
              V{version?.version ?? 1}
              {versions.length > 1 ? <IconChevronDown size={11} /> : null}
            </button>
            {menu === "version" ? (
              <>
                <span className="fixed inset-0 z-20" onClick={() => setMenu(null)} />
                <div className="absolute right-0 z-30 mt-1 w-44 rounded-lg border border-line bg-raised py-1 shadow-xl">
                  {versions.map((v) => (
                    <div key={v.id} className="flex items-center">
                      <button
                        type="button"
                        onClick={() => {
                          onVersionChange(v);
                          setMenu(null);
                        }}
                        className={`flex flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-hover ${
                          v.id === version?.id ? "text-accent-hi" : "text-ink-2"
                        }`}
                      >
                        <IconLayers size={12} />
                        <span>Version {v.version}</span>
                        <span className="ml-auto text-[10px] text-ink-3">
                          {v.duration_seconds ? timecode(v.duration_seconds) : v.status}
                        </span>
                      </button>
                      {v.id !== version?.id && v.playback_url ? (
                        <button
                          type="button"
                          title={`Compare against v${v.version}`}
                          onClick={() => {
                            setCompareWith(v);
                            setMenu(null);
                          }}
                          className="px-2 py-1.5 text-[10px] text-ink-3 hover:bg-hover hover:text-ink"
                        >
                          Compare
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {/* Anyone who can open this cut can take the file away — the untouched
            upload where there is one, Stream's copy for older versions. */}
        {version?.status === "ready" ? (
          <a
            href={`/api/cut-original/${version.id}`}
            title={`Download version ${version.version}`}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-raised px-2 py-1 text-[11px] font-semibold text-ink-2 hover:bg-hover hover:text-ink"
          >
            <IconDownload size={12} />
            Download the video
          </a>
        ) : null}

        {/* Allowed to shrink and wrap: the stage controls grew past a phone's
            width, and `shrink-0` meant the inner flex-wrap never got the chance
            to wrap — the whole page scrolled sideways instead. */}
        {headerActions ? (
          <div className="min-w-0 max-w-full basis-full sm:basis-auto">{headerActions}</div>
        ) : null}
      </div>

      {/* Cut tabs (main + hook variants) */}
      {cuts.length > 1 ? (
        <div className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 py-1.5">
          {cuts.map((c) => {
            const open = comments.filter(
              (x) => x.cut_id === c.id && !x.resolved && !x.parent_comment_id
            ).length;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onCutChange(c.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition ${
                  c.id === activeCut.id
                    ? "bg-raised text-ink"
                    : "text-ink-3 hover:bg-hover hover:text-ink-2"
                }`}
              >
                {c.label}
                {open ? (
                  <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white">
                    {open}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Frame */}
      {/* On phones the frame sizes to the clip and the leftover space falls
          below the toolbar, instead of a tall black band above it. */}
      <div className="flex min-h-0 flex-1 items-center justify-center bg-app p-3 max-lg:max-h-[52vh] max-lg:flex-none lg:bg-black">
        <div
          ref={frameRef}
          className="relative flex max-h-full max-w-full items-center justify-center"
        >
          {version?.playback_url && compareWith?.playback_url ? (
            // Written out twice rather than mapped: the two players take
            // different refs and only the primary drives the shared transport.
            <div className="flex w-full items-start gap-2">
              <div className="relative min-w-0 flex-1">
                <StreamPlayer
                  ref={playerRef}
                  playbackUrl={version.playback_url}
                  poster={version.thumbnail_url}
                  controls={false}
                  className="max-h-[calc(100vh-24rem)] w-full rounded-lg"
                  onTimeUpdate={handleTime}
                  onLoaded={onDuration}
                  onPlayStateChange={onPlayState}
                />
                <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white backdrop-blur">
                  v{version.version}
                </span>
              </div>
              <div className="relative min-w-0 flex-1">
                <StreamPlayer
                  ref={compareRef}
                  playbackUrl={compareWith.playback_url}
                  poster={compareWith.thumbnail_url}
                  controls={false}
                  className="max-h-[calc(100vh-24rem)] w-full rounded-lg"
                />
                <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white backdrop-blur">
                  v{compareWith.version} (comparing)
                </span>
              </div>
            </div>
          ) : version?.playback_url ? (
            <>
              <StreamPlayer
                ref={playerRef}
                playbackUrl={version.playback_url}
                poster={version.thumbnail_url}
                controls={false}
                className="max-h-[calc(100vh-22rem)] w-auto max-w-full rounded-lg"
                onTimeUpdate={handleTime}
                onLoaded={onDuration}
                onPlayStateChange={onPlayState}
              />
              {showSaved && activeComment?.drawing ? (
                <DrawingView drawing={activeComment.drawing} revealUpTo={revealUpTo} />
              ) : null}
              {tool === "draw" ? (
                <DrawLayer value={drawing} onChange={onDrawing} recordingSince={recordingSince} />
              ) : null}

              <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white/80 backdrop-blur">
                {timecode(duration)}
              </span>
            </>
          ) : (
            <div className="flex aspect-video w-full max-w-lg flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong text-ink-3">
              <IconLayers size={22} />
              <p className="text-sm">
                {version ? `This version is ${version.status}.` : "No cut uploaded yet."}
              </p>
            </div>
          )}
        </div>
      </div>

      {compareWith ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-line bg-card px-3 py-1.5 text-[11px]">
          <span className="text-ink-2">
            Comparing v{version?.version} with v{compareWith.version}
          </span>
          <label className="ml-auto flex items-center gap-1.5 text-ink-2">
            <input
              type="checkbox"
              checked={sync}
              onChange={(e) => setSync(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--color-accent)]"
            />
            Sync playback
          </label>
          <button
            type="button"
            onClick={() => setCompareWith(null)}
            className="rounded-md border border-line px-2 py-1 text-ink-2 hover:bg-hover hover:text-ink"
          >
            Stop comparing
          </button>
        </div>
      ) : null}

      {/* Timeline */}
      <div className="shrink-0">
        <Timeline
          duration={duration}
          current={current}
          comments={comments.filter((c) => c.cut_id === activeCut.id)}
          activeId={activeId}
          selection={selection}
          sectionMode={tool === "section"}
          onSeek={onSeek}
          onSelect={onSelect}
          onPinClick={onPinClick}
        />

        {/* Transport */}
        <div className="flex items-center gap-2 px-4 pb-2">
          <button
            type="button"
            onClick={() => {
              playerRef.current?.toggle();
              if (compareWith && sync) compareRef.current?.toggle();
            }}
            aria-label={playing ? "Pause" : "Play"}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-raised text-ink hover:bg-hover"
          >
            {playing ? <IconPause size={16} /> : <IconPlay size={16} />}
          </button>
          <button
            type="button"
            onClick={() => {
              const next = !muted;
              setMuted(next);
              playerRef.current?.setMuted(next);
            }}
            aria-label={muted ? "Unmute" : "Mute"}
            className="rounded-md p-1.5 text-ink-2 hover:bg-hover hover:text-ink"
          >
            {muted ? <IconMuted size={16} /> : <IconVolume size={16} />}
          </button>
          <span className="font-mono text-xs tabular-nums text-ink-2">
            {timecode(current)} / {timecode(duration)}
          </span>
          <span className="hidden font-mono text-xs tabular-nums text-ink-3 sm:inline">
            {frameLabel(current)}
          </span>

          <button
            type="button"
            onClick={() => {
              const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
              setRate(next);
              playerRef.current?.setRate(next);
            }}
            className="ml-auto rounded-md px-2 py-1 font-mono text-xs text-ink-2 hover:bg-hover hover:text-ink"
          >
            {rate}x
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label="Fullscreen"
            className="rounded-md p-1.5 text-ink-2 hover:bg-hover hover:text-ink"
          >
            <IconFullscreen size={16} />
          </button>
        </div>

        {/* Annotation toolbar */}
        <div className="flex items-center gap-1.5 border-t border-line px-3 py-2.5">
          <ToolButton
            icon={<IconSection size={14} />}
            label="Section"
            active={tool === "section"}
            onClick={() => {
              const next = tool === "section" ? "none" : "section";
              onTool(next);
              if (next === "none") onSelect(null);
              else onOpenComposer();
            }}
            title="Drag the timeline to mark an in/out range"
          />
          <ToolButton
            icon={<IconComment size={14} />}
            label="Comment"
            active={composerOpen && tool === "none"}
            onClick={() => {
              onTool("none");
              onOpenComposer();
            }}
            title="Comment at the current timecode"
          />
          <ToolButton
            icon={<IconDraw size={14} />}
            label="Draw"
            active={tool === "draw"}
            onClick={() => {
              const next = tool === "draw" ? "none" : "draw";
              onTool(next);
              if (next === "draw") {
                playerRef.current?.pause();
                onOpenComposer();
              }
            }}
            title="Draw on the frame"
          />
          <button
            type="button"
            onClick={onStartVoice}
            aria-label="Record a voice note"
            title="Record a voice note"
            className="rounded-lg border border-line px-2.5 py-1.5 text-ink-2 hover:bg-hover hover:text-ink"
          >
            <IconMic size={14} />
          </button>
          <button
            type="button"
            onClick={onStartScreen}
            aria-label="Record your screen"
            title="Record your screen — talk over the cut while you scrub it"
            className="rounded-lg border border-line px-2.5 py-1.5 text-ink-2 hover:bg-hover hover:text-ink"
          >
            <IconScreenRecord size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolButton({
  icon,
  label,
  active,
  onClick,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${
        active
          ? "border-accent bg-accent-ghost text-accent-hi"
          : "border-line text-ink-2 hover:bg-hover hover:text-ink"
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
