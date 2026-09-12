"use client";

import { useRef, useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { setStatusAction } from "@/app/actions";
import {
  addCutCommentAction,
  deleteCutCommentAction,
  toggleCommentResolvedAction,
} from "@/app/engine-actions";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { PlayerHandle } from "@/components/engine/StreamPlayer";
import { PlayerPane, type Tool } from "@/components/workspace/PlayerPane";
import { CarouselViewer } from "@/components/workspace/CarouselViewer";
import { CommentsTab } from "@/components/workspace/CommentsTab";
import { Composer, type ComposerSubmit } from "@/components/workspace/Composer";
import type { Selection } from "@/components/workspace/Timeline";
import { StatusBadge, PriorityPill, Chip } from "@/components/badges";
import { isCarouselFormat } from "@/lib/taxonomy";
import type {
  CarouselImage,
  CutComment,
  CutWithVersions,
  Drawing,
  Profile,
  VideoWithEditor,
} from "@/lib/types";

type Person = Pick<Profile, "id" | "full_name" | "email">;

/**
 * The full review & comment experience — the same player, timeline, threaded
 * comments, voice notes and drawing annotations as the client-facing
 * workspace, just laid out for a single scrolling column so it works as well
 * from a phone as a desktop. This is what "Watch the cut" opens for an
 * editor, and what a manager gets for a fast mobile check, with the
 * thumb-reachable Approve / Revisions bar layered on top for whoever can act
 * on it.
 */
export function ReviewMode({
  video,
  viewer,
  roster,
  cuts,
  commentsByCut,
  carouselImages,
  canApprove,
}: {
  video: VideoWithEditor;
  viewer: Profile;
  roster: Person[];
  cuts: CutWithVersions[];
  commentsByCut: Record<string, CutComment[]>;
  carouselImages: CarouselImage[];
  canApprove: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const playerRef = useRef<PlayerHandle>(null);
  const [pending, startTransition] = useTrackedTransition();

  const [activeCutId, setActiveCutId] = useState(cuts[0]?.id ?? "");
  const activeCut = cuts.find((c) => c.id === activeCutId) ?? cuts[0];
  const versions = activeCut?.versions ?? [];
  const [versionId, setVersionId] = useState(versions[0]?.id ?? "");
  const version = versions.find((v) => v.id === versionId) ?? versions[0] ?? null;

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
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  const [voiceAt, setVoiceAt] = useState<{ commentId: string; t: number } | null>(null);

  // Reset transport state when the cut or version changes underneath us.
  const [lastVersion, setLastVersion] = useState(version?.id);
  if (version?.id !== lastVersion) {
    setLastVersion(version?.id);
    setDuration(version?.duration_seconds ?? 0);
    setCurrent(0);
    setActiveId(null);
  }

  const allComments = Object.values(commentsByCut).flat();
  const cutComments = allComments.filter((c) => c.cut_id === activeCut?.id);

  function seek(t: number) {
    playerRef.current?.seek(t);
    setCurrent(t);
  }

  function openComposer() {
    setComposerOpen(true);
  }

  function selectComment(c: CutComment) {
    setActiveId(c.id);
    if (c.t_start_seconds != null) seek(c.t_start_seconds);
  }

  async function submitComment(payload: ComposerSubmit) {
    if (!activeCut) return { error: "No cut to comment on." };
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

  function move(status: "approved" | "revisions") {
    startTransition(async () => {
      const r = await setStatusAction(video.id, status);
      if (toast.result(r, status === "approved" ? "Approved ✓" : "Sent back for revisions")) {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4 pb-28">
      <div>
        <h1 className="text-lg font-semibold leading-snug">{video.title}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <PriorityPill priority={video.priority} />
          <StatusBadge status={video.status} />
          {video.assigned_editor ? (
            <Chip>{video.assigned_editor.full_name || video.assigned_editor.email}</Chip>
          ) : null}
        </div>
      </div>

      {activeCut?.kind === "hook" && activeCut.notes ? (
        <p className="rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink-2">
          <span className="text-ink-3">What&rsquo;s different: </span>
          {activeCut.notes}
        </p>
      ) : null}

      {isCarouselFormat(video.formats) ? (
        <div className="h-[62vh] min-h-[420px] overflow-hidden rounded-2xl border border-line">
          <CarouselViewer images={carouselImages} />
        </div>
      ) : !activeCut ? (
        <div className="flex h-[40vh] items-center justify-center rounded-2xl border border-line text-sm text-ink-3">
          This video has no cuts yet.
        </div>
      ) : (
        <div className="h-[62vh] min-h-[420px] overflow-hidden rounded-2xl border border-line">
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
            comments={allComments}
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
            onPinClick={selectComment}
            playerRef={playerRef}
            backHref={`/videos/${video.id}`}
          />
        </div>
      )}

      {/* Notes — the same threaded, resolvable, voice + drawing comments as
          the workspace, just stacked under the player instead of beside it. */}
      <div className="rounded-2xl border border-line bg-app">
        <div className="max-h-[46vh] overflow-hidden">
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
              if (activeId !== c.id) setActiveId(c.id);
              setVoiceAt({ commentId: c.id, t });
            }}
          />
        </div>

        {!composerOpen && activeCut ? (
          <div className="border-t border-line p-3">
            <button
              type="button"
              onClick={openComposer}
              className="w-full rounded-lg border border-dashed border-line-strong px-3 py-2.5 text-center text-sm text-ink-2 hover:border-accent hover:text-ink"
            >
              Leave a note…
            </button>
          </div>
        ) : null}

        {composerOpen ? (
          <div className="border-t border-line p-3">
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

      {/* thumb-reachable action bar */}
      {canApprove ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-app/95 px-3 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-2xl gap-2">
            <button
              onClick={() => move("revisions")}
              disabled={pending}
              className="flex-1 rounded-xl border border-orange-900 bg-orange-950 py-3.5 text-sm font-medium text-orange-200 active:bg-orange-900 disabled:opacity-50"
            >
              Request revisions
            </button>
            <button
              onClick={() => move("approved")}
              disabled={pending}
              className="flex-1 rounded-xl bg-emerald-600 py-3.5 text-sm font-semibold text-white active:bg-emerald-500 disabled:opacity-50"
            >
              Approve
            </button>
          </div>
        </div>
      ) : null}

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
    </div>
  );
}
