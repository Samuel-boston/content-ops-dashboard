"use client";

import { useRef, useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import type { PlayerHandle } from "@/components/engine/StreamPlayer";
import { PlayerPane, type Tool } from "@/components/workspace/PlayerPane";
import { CarouselViewer } from "@/components/workspace/CarouselViewer";
import { Composer, type ComposerSubmit } from "@/components/workspace/Composer";
import { CommentsTab } from "@/components/workspace/CommentsTab";
import { BriefTab } from "@/components/workspace/BriefTab";
import { TranscriptTab } from "@/components/workspace/TranscriptTab";
import { PostTab } from "@/components/workspace/PostTab";
import { FilesTab } from "@/components/workspace/FilesTab";
import { ChatTab } from "@/components/workspace/ChatTab";
import { HookPane } from "@/components/workspace/HookPane";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { Selection } from "@/components/workspace/Timeline";
import {
  addCutCommentAction,
  deleteCutCommentAction,
  toggleCommentResolvedAction,
} from "@/app/engine-actions";
import { StageActions } from "@/components/pipeline/StageActions";
import { isCarouselFormat } from "@/lib/taxonomy";
import type {
  Series,
  CarouselImage,
  CutComment,
  CutTranscript,

  CutWithVersions,
  Drawing,
  GuestLink,
  Profile,
  PublishJob,
  IntegrationStatus,
  ReferenceItem,
  Video,
  VideoActivity,
  VideoAsset,
  VideoMessage,
  VideoMetrics,
} from "@/lib/types";

const TABS = ["comments", "brief", "transcript", "files", "chat", "post"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  comments: "Comments",
  brief: "Brief",
  transcript: "Transcript",
  files: "Files & Share",
  chat: "Chat",
  post: "Post",
};

export function VideoWorkspace({
  video,
  viewer,
  cuts,
  comments,
  transcript,
  roster,
  customs,
  publishJobs,
  overdue,
  assets,
  carouselImages,
  references,
  messages,
  activity,
  metrics,
  integrations,
  guestLinks,
  seriesOptions,
}: {
  video: Video;
  viewer: Profile;
  cuts: CutWithVersions[];
  comments: CutComment[];
  transcript: CutTranscript | null;
  roster: Pick<Profile, "id" | "full_name" | "email">[];
  customs: { content_pillar: string[]; format: string[]; platform: string[] };
  publishJobs: PublishJob[];
  /** Computed in the data layer — reading the clock in render is impure. */
  overdue: boolean;
  assets: VideoAsset[];
  carouselImages: CarouselImage[];
  references: ReferenceItem[];
  messages: VideoMessage[];
  activity: VideoActivity[];
  metrics: VideoMetrics | null;
  integrations: IntegrationStatus;
  guestLinks: GuestLink[];
  seriesOptions: Series[];
}) {
  const router = useRouter();
  const toast = useToast();
  const playerRef = useRef<PlayerHandle>(null);
  const [, startTransition] = useTrackedTransition();

  const [activeCutId, setActiveCutId] = useState(cuts[0]?.id ?? "");
  const activeCut = cuts.find((c) => c.id === activeCutId) ?? cuts[0];
  const versions = activeCut?.versions ?? [];

  const [versionId, setVersionId] = useState(versions[0]?.id ?? "");
  const version = versions.find((v) => v.id === versionId) ?? versions[0] ?? null;

  // Ready to Post is a finished video, not one under review — the review's
  // over, so it opens straight onto the caption/schedule tab instead of the
  // comments thread everyone else lands on.
  const [tab, setTab] = useState<Tab>(video.status === "ready_to_post" ? "post" : "comments");
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(version?.duration_seconds ?? 0);
  const [playing, setPlaying] = useState(false);
  const [tool, setTool] = useState<Tool>("none");
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<CutComment | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CutComment | null>(null);
  const [attachNonce, setAttachNonce] = useState(0);
  const [voiceNonce, setVoiceNonce] = useState(0);
  const [screenNonce, setScreenNonce] = useState(0);
  const [mobilePane, setMobilePane] = useState<"player" | "panel">("player");
  // Draw-while-talking: the composer records, the draw layer lives on the
  // player, and playback of a saved note drives the replay — so both timings
  // are held here, where those three panes meet.
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  const [voiceAt, setVoiceAt] = useState<{ commentId: string; t: number } | null>(null);

  // Reset transport state when the cut or version changes (render phase, not an
  // effect — the old duration must never paint against the new file).
  const [lastVersion, setLastVersion] = useState(version?.id);
  if (version?.id !== lastVersion) {
    setLastVersion(version?.id);
    setDuration(version?.duration_seconds ?? 0);
    setCurrent(0);
    setActiveId(null);
  }

  const cutComments = comments.filter((c) => c.cut_id === activeCut?.id);

  function seek(t: number) {
    playerRef.current?.seek(t);
    setCurrent(t);
  }

  function openComposer() {
    setComposerOpen(true);
    setTab("comments");
    setMobilePane("panel");
  }

  function selectComment(c: CutComment) {
    setActiveId(c.id);
    if (c.t_start_seconds != null) seek(c.t_start_seconds);
  }

  async function submitComment(payload: ComposerSubmit) {
    const res = await addCutCommentAction({
      cutId: activeCut.id,
      videoId: video.id,
      version: version?.version ?? null,
      body: payload.body,
      tStart: replyTo ? null : (selection?.start ?? current),
      tEnd: replyTo ? null : (selection?.end ?? null),
      parentId: replyTo?.id ?? null,
      visibility: payload.visibility,
      assigneeId: payload.assigneeId,
      drawing: payload.drawing,
      voicePath: payload.voicePath,
      voiceDuration: payload.voiceDuration,
      voicePeaks: payload.voicePeaks,
      attachments: payload.attachments,
    });
    if (!res?.error) {
      setSelection(null);
      setTool("none");
      router.refresh();
    }
    return res;
  }

  const panel = (
    <div className="flex h-full min-h-0 flex-col border-line bg-app">
      {/* Tabs */}
      <div className="no-scrollbar flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-3 pt-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={tab === t ? "page" : undefined}
            className={`relative shrink-0 px-2.5 pb-2.5 pt-1 text-sm transition ${
              tab === t ? "text-ink" : "text-ink-3 hover:text-ink-2"
            }`}
          >
            {TAB_LABELS[t]}
            {t === "comments" && cutComments.filter((c) => !c.parent_comment_id).length ? (
              <span className="ml-1.5 text-ink-3">
                {cutComments.filter((c) => !c.parent_comment_id).length}
              </span>
            ) : null}
            {tab === t ? (
              <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-ink" />
            ) : null}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {tab === "comments" ? (
          <CommentsTab
            comments={cutComments}
            viewer={viewer}
            activeId={activeId}
            videoId={video.id}
            onSelect={selectComment}
            onReply={(c) => {
              setReplyTo(c);
              openComposer();
            }}
            onToggleResolved={(c) =>
              startTransition(async () => {
                const res = await toggleCommentResolvedAction(c.id, video.id);
                if (res?.error) toast.error(res.error);
                else router.refresh();
              })
            }
            onDelete={(c) => setConfirmDelete(c)}
            onVoiceTime={(c, t) => {
              // Selecting the comment is what puts its drawing on the frame.
              if (activeId !== c.id) setActiveId(c.id);
              setVoiceAt({ commentId: c.id, t });
            }}
          />
        ) : null}

        {tab === "brief" ? (
          <BriefTab
            video={video}
            customs={customs}
            canEdit={viewer.role !== "editor"}
            seriesOptions={seriesOptions}
          />
        ) : null}

        {tab === "transcript" ? (
          <TranscriptTab
            transcript={transcript}
            cutId={activeCut?.id ?? ""}
            version={version?.version ?? 1}
            videoId={video.id}
            currentTime={current}
            canGenerate={!!version?.playback_url}
            onSeek={seek}
            onCommentRange={(start, end) => {
              setSelection({ start, end });
              seek(start);
              openComposer();
            }}
          />
        ) : null}

        {tab === "files" ? (
          <FilesTab
            videoId={video.id}
            cuts={cuts}
            activeCutId={activeCut?.id ?? ""}
            onCutChange={(id) => {
              setActiveCutId(id);
              const next = cuts.find((c) => c.id === id)?.versions[0];
              setVersionId(next?.id ?? "");
            }}
            assets={assets}
            references={references}
            driveConfigured={integrations.drive}
            streamConfigured={integrations.stream}
            canEdit={viewer.role !== "editor" || video.assigned_editor_id === viewer.id}
            guestLinks={guestLinks}
            canShare={viewer.role !== "editor"}
          />
        ) : null}

        {tab === "chat" ? (
          <ChatTab
            videoId={video.id}
            viewer={viewer}
            messages={messages}
            roster={roster}
            activity={activity}
            metrics={metrics}
            instagramConfigured={integrations.instagram}
          />
        ) : null}

        {tab === "post" ? (
          <PostTab
            video={video}
            cutId={activeCut?.id ?? null}
            jobs={publishJobs}
            canManage={viewer.role !== "editor"}
            instagramConfigured={integrations.instagram}
            durationSeconds={version?.duration_seconds ?? null}
          />
        ) : null}
      </div>

      {composerOpen ? (
        <div className="shrink-0 border-t border-line p-3">
          <Composer
            viewer={viewer}
            roster={roster}
            selection={selection}
            currentTime={current}
            drawing={drawing}
            onClearDrawing={() => {
              setDrawing(null);
              setTool((t) => (t === "draw" ? "none" : t));
            }}
            onToggleDraw={() => setTool((t) => (t === "draw" ? "none" : "draw"))}
            drawing_active={tool === "draw"}
            replyingTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            onSubmit={submitComment}
            onClose={() => {
              setComposerOpen(false);
              setReplyTo(null);
              setSelection(null);
              setDrawing(null);
              setTool("none");
            }}
            attachNonce={attachNonce}
            voiceNonce={voiceNonce}
            screenNonce={screenNonce}
            onRecordingChange={setRecordingSince}
          />
        </div>
      ) : null}
    </div>
  );

  if (!activeCut) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-sm text-ink-3">
        This video has no cuts yet.
      </div>
    );
  }

  const player = isCarouselFormat(video.formats) ? (
    <CarouselViewer images={carouselImages} />
  ) : (
    <PlayerPane
      video={video}
      cuts={cuts}
      activeCut={activeCut}
      onCutChange={(id) => {
        setActiveCutId(id);
        const next = cuts.find((c) => c.id === id)?.versions[0];
        setVersionId(next?.id ?? "");
      }}
      version={version}
      versions={versions}
      onVersionChange={(v) => setVersionId(v.id)}
      comments={comments}
      activeId={activeId}
      current={current}
      duration={duration}
      playing={playing}
      selection={selection}
      tool={tool}
      drawing={drawing}
      composerOpen={composerOpen}
      onSeek={seek}
      onDuration={(d) => setDuration(d || version?.duration_seconds || 0)}
      onTime={setCurrent}
      onPlayState={setPlaying}
      onSelect={setSelection}
      onTool={setTool}
      onDrawing={setDrawing}
      onOpenComposer={openComposer}
      onStartVoice={() => {
        openComposer();
        setVoiceNonce((n) => n + 1);
      }}
      onStartScreen={() => {
        openComposer();
        setScreenNonce((n) => n + 1);
      }}
      onAttach={() => {
        openComposer();
        setAttachNonce((n) => n + 1);
      }}
      recordingSince={recordingSince}
      revealUpTo={voiceAt && voiceAt.commentId === activeId ? voiceAt.t : undefined}
      onPinClick={(c) => {
        selectComment(c);
        setTab("comments");
        setMobilePane("panel");
      }}
      headerActions={<StageActions video={video} viewer={viewer} overdue={overdue} />}
      playerRef={playerRef}
      backHref={viewer.role === "editor" ? "/queue" : "/board"}
    />
  );

  return (
    <>
      {/* Mobile: one pane at a time */}
      <div className="flex h-[calc(100dvh-3.5rem)] flex-col lg:hidden">
        <div className="flex shrink-0 gap-1 border-b border-line bg-app p-2">
          {(["player", "panel"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setMobilePane(p)}
              className={`flex-1 rounded-lg py-2 text-xs font-medium transition ${
                mobilePane === p ? "bg-raised text-ink" : "text-ink-3"
              }`}
            >
              {p === "player" ? "Player" : "Comments & brief"}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">{mobilePane === "player" ? player : panel}</div>
      </div>

      {/* Desktop: player | tabs | this video's cuts */}
      {/* grid-rows-[minmax(0,1fr)] + min-h-0 panes: without both, the row is
          sized by the tallest pane and the player scrolls off. */}
      <div className="hidden h-[calc(100dvh-3.5rem)] lg:grid lg:grid-cols-[minmax(380px,1fr)_minmax(320px,360px)] lg:grid-rows-[minmax(0,1fr)] xl:grid-cols-[minmax(420px,1fr)_minmax(330px,370px)_minmax(260px,300px)]">
        <div className="min-h-0 min-w-0 overflow-hidden border-r border-line">{player}</div>
        <div className="min-h-0 min-w-0 overflow-hidden border-r border-line">{panel}</div>
        <div className="hidden min-h-0 min-w-0 overflow-hidden xl:block">
          <HookPane
            video={video}
            cuts={cuts}
            comments={comments}
            activeCutId={activeCut.id}
            onCutChange={(id) => {
              setActiveCutId(id);
              const next = cuts.find((c) => c.id === id)?.versions[0];
              setVersionId(next?.id ?? "");
            }}
            canEdit={viewer.role !== "editor" || video.assigned_editor_id === viewer.id}
          />
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete this comment?"
        body="It'll be removed for everyone, along with any replies."
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const c = confirmDelete;
          setConfirmDelete(null);
          if (!c) return;
          startTransition(async () => {
            const res = await deleteCutCommentAction(c.id, video.id);
            if (res?.error) toast.error(res.error);
            else router.refresh();
          });
        }}
      />
    </>
  );
}
