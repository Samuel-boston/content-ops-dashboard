"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import type { PlayerHandle } from "@/components/engine/StreamPlayer";
import { PlayerPane, type Tool } from "@/components/workspace/PlayerPane";
import { CarouselViewer } from "@/components/workspace/CarouselViewer";
import { Composer, type ComposerSubmit } from "@/components/workspace/Composer";
import { CommentsTab } from "@/components/workspace/CommentsTab";
import { BriefTab } from "@/components/workspace/BriefTab";
import { PostTab } from "@/components/workspace/PostTab";
import { FilesTab } from "@/components/workspace/FilesTab";
import { ChatTab } from "@/components/workspace/ChatTab";
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

type Tab = "comments" | "brief" | "files" | "chat" | "post";

/**
 * Post only belongs on screen once there's something to post — everywhere
 * else it was a tab that did nothing, competing with tabs that mattered.
 * Pinned first at Ready to Post / Posted since it's the reason you're there.
 */
function visibleTabs(status: Video["status"], editor = false): Tab[] {
  // Editors don't post, so they never get the Post tab.
  if (editor) return ["comments", "brief", "files", "chat"];
  if (status === "ready_to_post" || status === "posted") {
    return ["post", "comments", "brief", "files", "chat"];
  }
  // Once variants are being handed over, the list of them (and what to do with
  // each) is the main thing to see — even before there's more than one.
  if (status === "awaiting_variants" || status === "final_review") {
    return ["post", "comments", "brief", "files", "chat"];
  }
  return ["comments", "brief", "files", "chat"];
}

const TAB_LABELS: Record<Tab, string> = {
  comments: "Comments",
  brief: "Brief",
  files: "Files & Share",
  chat: "Chat",
  post: "Post",
};

// Narrower than this and the player header (title, version, download) no longer
// fits on one row; the right pane needs room for its four tabs.
const MIN_PLAYER_W = 440;
const MIN_PANEL_W = 380;

export function VideoWorkspace({
  video,
  viewer,
  cuts,
  comments,
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
  const [tab, setTab] = useState<Tab>(
    viewer.role !== "editor" &&
      (video.status === "ready_to_post" ||
        video.status === "posted" ||
        video.status === "final_review")
      ? "post"
      : "comments"
  );
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(version?.duration_seconds ?? 0);
  // Short-form is the norm here, and a 9:16 frame leaves black bars either
  // side — so once the video reports its size, a portrait cut gives the
  // comments panel the width instead.
  const [portrait, setPortrait] = useState(false);
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

  // Width of the player pane on desktop. null = the layout's own default; a
  // dragged width is remembered in this browser.
  const splitRef = useRef<HTMLDivElement>(null);
  const [playerW, setPlayerW] = useState<number | null>(() => {
    try {
      const v = Number(window.localStorage.getItem("cod.playerWidth"));
      return v >= MIN_PLAYER_W ? v : null;
    } catch {
      return null;
    }
  });
  // The narrowest the player can be before its stage buttons wrap onto a second
  // line and push the video down — measured from the real buttons, because the
  // set differs by stage and role.
  const [actionsW, setActionsW] = useState(0);
  useEffect(() => {
    const row = splitRef.current?.querySelector<HTMLElement>("[data-stage-actions]");
    if (!row) return;
    const measure = () => {
      const list = row.firstElementChild;
      if (!list) return setActionsW(0);
      const kids = Array.from(list.children) as HTMLElement[];
      const widths = kids.map((k) => k.offsetWidth).filter((w) => w > 0);
      const sum = widths.reduce((a, b) => a + b, 0) + Math.max(0, widths.length - 1) * 8;
      setActionsW(Math.ceil(sum + 24 + 2)); // the row's own padding and the divider
    };
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    if (row.firstElementChild) ro.observe(row.firstElementChild);
    measure();
    return () => ro.disconnect();
  }, []);
  const minPlayerW = Math.max(MIN_PLAYER_W, actionsW);
  const savePlayerW = useCallback((w: number | null) => {
    setPlayerW(w);
    try {
      if (w) window.localStorage.setItem("cod.playerWidth", String(Math.round(w)));
      else window.localStorage.removeItem("cod.playerWidth");
    } catch {
      /* private mode — the width just won't be remembered */
    }
  }, []);
  const startResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const box = splitRef.current;
      if (!box) return;
      e.preventDefault();
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);
      const left = box.getBoundingClientRect().left;
      const total = box.getBoundingClientRect().width;
      const move = (ev: PointerEvent) => {
        setPlayerW(Math.min(Math.max(ev.clientX - left, minPlayerW), total - MIN_PANEL_W));
      };
      const up = (ev: PointerEvent) => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.releasePointerCapture(ev.pointerId);
        savePlayerW(Math.min(Math.max(ev.clientX - left, minPlayerW), total - MIN_PANEL_W));
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    },
    [savePlayerW, minPlayerW]
  );
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
        {visibleTabs(video.status, viewer.role === "editor").map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={tab === t ? "page" : undefined}
            className={`relative shrink-0 px-2.5 pb-2.5 pt-1 text-sm transition ${
              tab === t ? "text-ink" : "text-ink-3 hover:text-ink-2"
            }`}
          >
            {t === "post" && (video.status === "awaiting_variants" || video.status === "final_review")
              ? "Variants"
              : TAB_LABELS[t]}
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

        {tab === "files" ? (
          <FilesTab
            video={video}
            videoId={video.id}
            cuts={cuts}
            comments={comments}
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
            canShare={viewer.role !== "editor" || video.assigned_editor_id === viewer.id}
        canDeliverLinks={viewer.role === "editor" && video.assigned_editor_id === viewer.id}
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
            variantsOnly={video.status === "awaiting_variants" || video.status === "final_review"}
            onWatch={(cutId) => {
              setActiveCutId(cutId);
              const next = cuts.find((c) => c.id === cutId)?.versions[0];
              setVersionId(next?.id ?? "");
              setMobilePane("player");
            }}
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
      onDuration={(d) => {
        setDuration(d || version?.duration_seconds || 0);
        const el = playerRef.current?.element();
        if (el?.videoWidth) setPortrait(el.videoHeight > el.videoWidth);
      }}
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

      {/* Desktop: player | tabs (comments, files — cuts & hooks live there too) */}
      {/* grid-rows-[minmax(0,1fr)] + min-h-0 panes: without both, the row is
          sized by the tallest pane and the player scrolls off. */}
      <div
        ref={splitRef}
        suppressHydrationWarning
        style={{
          gridTemplateColumns: playerW
            ? `max(${minPlayerW}px, min(${playerW}px, calc(100% - ${MIN_PANEL_W + 8}px))) 8px minmax(0,1fr)`
            : portrait
              ? `minmax(${Math.max(340, minPlayerW)}px, ${Math.max(440, minPlayerW)}px) 8px minmax(0,1fr)`
              : `minmax(${Math.max(420, minPlayerW)}px, 1fr) 8px minmax(330px, 420px)`,
        }}
        className="hidden h-[calc(100dvh-3.5rem)] lg:grid lg:grid-rows-[minmax(0,1fr)]"
      >
        <div className="min-h-0 min-w-0 overflow-hidden">{player}</div>
        {/* Drag to resize; double-click to put it back. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the player and comments panels"
          title="Drag to resize — double-click to reset"
          onPointerDown={startResize}
          onDoubleClick={() => savePlayerW(null)}
          className="group relative cursor-col-resize touch-none select-none border-x border-line bg-app transition hover:border-accent/60 hover:bg-accent/10"
        >
          <span className="pointer-events-none absolute left-1/2 top-1/2 h-10 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-line-strong group-hover:bg-accent" />
        </div>
        <div className="min-h-0 min-w-0 overflow-hidden">{panel}</div>
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
