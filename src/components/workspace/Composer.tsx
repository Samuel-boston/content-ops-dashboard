"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { useToast } from "@/components/ui/Toast";
import {
  IconChevronDown,
  IconDraw,
  IconFile,
  IconMic,
  IconPaperclip,
  IconScreenRecord,
  IconSend,
  IconX,
} from "@/components/ui/icons";
import { VoiceRecorder, VoicePlayer, type VoiceCapture } from "@/components/workspace/Voice";
import { ScreenRecorder, type ScreenCapture } from "@/components/workspace/ScreenRecorder";
import { uploadCommentMedia } from "@/lib/upload-client";
import { displayName, fileSize, timeRange } from "@/lib/format";
import type { CommentAttachment, CommentVisibility, Drawing, Profile } from "@/lib/types";
import type { Selection } from "@/components/workspace/Timeline";

export interface ComposerSubmit {
  body: string;
  visibility: CommentVisibility;
  assigneeId: string | null;
  drawing: Drawing | null;
  voicePath: string | null;
  voiceDuration: number | null;
  voicePeaks: number[] | null;
  attachments: CommentAttachment[];
}

type Person = Pick<Profile, "id" | "full_name" | "email">;

export function Composer({
  viewer,
  roster,
  selection,
  currentTime,
  drawing,
  onClearDrawing,
  onToggleDraw,
  drawing_active,
  replyingTo,
  onCancelReply,
  onSubmit,
  onClose,
  attachNonce,
  voiceNonce,
  screenNonce,
  onRecordingChange,
}: {
  viewer: Profile;
  roster: Person[];
  selection: Selection | null;
  currentTime: number;
  drawing: Drawing | null;
  onClearDrawing: () => void;
  onToggleDraw: () => void;
  drawing_active: boolean;
  replyingTo: { id: string; author?: Person | null } | null;
  onCancelReply: () => void;
  onSubmit: (payload: ComposerSubmit) => Promise<{ error?: string } | void>;
  onClose: () => void;
  /** Bumped by the player toolbar's paperclip to open the file picker here. */
  attachNonce: number;
  /** Bumped by the player toolbar's mic to start recording here. */
  voiceNonce: number;
  /** Bumped by the player toolbar's screen-record button. */
  screenNonce: number;
  /**
   * performance.now() when recording starts, null when it stops. The draw
   * layer lives on the player, so it needs this from up here.
   */
  onRecordingChange: (since: number | null) => void;
}) {
  const toast = useToast();
  const [body, setBody] = useState("");
  const [visibility] = useState<CommentVisibility>("internal");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<CommentAttachment[]>([]);
  const [voice, setVoice] = useState<{ capture: VoiceCapture; url: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [screenRec, setScreenRec] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [menu, setMenu] = useState<"assignee" | "visibility" | "mention" | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const assignee = roster.find((p) => p.id === assigneeId) ?? null;
  const stamp = selection ? timeRange(selection.start, selection.end) : timeRange(currentTime, null);

  // The Draw / mic / paperclip buttons live on the player toolbar, but the
  // pickers they drive belong to this composer — a bumped nonce is how that
  // reaches across. Skipped on mount (nonce 0) so nothing fires unprompted.
  useEffect(() => {
    if (attachNonce > 0) fileInput.current?.click();
  }, [attachNonce]);

  // Recording is plain state, so react to the bump during render rather than
  // from an effect (which would cost an extra render pass).
  const [seenVoiceNonce, setSeenVoiceNonce] = useState(voiceNonce);
  if (voiceNonce !== seenVoiceNonce) {
    setSeenVoiceNonce(voiceNonce);
    setRecording(true);
  }

  const [seenScreenNonce, setSeenScreenNonce] = useState(screenNonce);
  if (screenNonce !== seenScreenNonce) {
    setSeenScreenNonce(screenNonce);
    setScreenRec(true);
  }

  const onVoiceDone = useCallback((capture: VoiceCapture) => {
    setVoice({ capture, url: URL.createObjectURL(capture.blob) });
    setRecording(false);
    onRecordingChange(null);
  }, [onRecordingChange]);

  /**
   * A screen recording rides in as an ordinary attachment rather than a new
   * column: it's a file on a comment, and every surface that already renders
   * attachments picks it up for free.
   */
  const onScreenDone = useCallback(
    async (capture: ScreenCapture) => {
      setScreenRec(false);
      // Storage rejects anything over 50 MB, and it does so after the whole
      // upload has been sent. Better to say so before the wait than after it.
      if (capture.blob.size > 48 * 1024 * 1024) {
        toast.error("That recording is too large to attach. Try a shorter one.");
        return;
      }
      setUploading(true);
      try {
        const ext = capture.mimeType.includes("mp4") ? "mp4" : "webm";
        const up = await uploadCommentMedia(
          capture.blob,
          `screen-recording-${Math.round(capture.duration)}s.${ext}`,
          viewer.id
        );
        setAttachments((prev) => [...prev, up]);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setUploading(false);
      }
    },
    [viewer.id, toast]
  );

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(
        [...files].map((f) => uploadCommentMedia(f, f.name, viewer.id))
      );
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  /** Insert "@Name " at the caret — the server matches mentions on full name. */
  function insertMention(p: Person) {
    const el = textarea.current;
    const name = displayName(p);
    if (!el) {
      setBody((b) => `${b}@${name} `);
    } else {
      const at = el.selectionStart;
      // Replace the partial "@..." token the user was typing, if any.
      const before = body.slice(0, at).replace(/@[\w.-]*$/, "");
      setBody(`${before}@${name} ${body.slice(at)}`);
    }
    setMenu(null);
    queueMicrotask(() => textarea.current?.focus());
  }

  async function submit() {
    if (busy) return;
    const hasContent = body.trim() || voice || drawing?.strokes.length || attachments.length;
    if (!hasContent) {
      toast.error("Add a note, a recording, a drawing or a file.");
      return;
    }
    setBusy(true);
    try {
      let voicePath: string | null = null;
      if (voice) {
        const ext = voice.capture.blob.type.includes("mp4") ? "mp4" : "webm";
        const up = await uploadCommentMedia(
          voice.capture.blob,
          `voice-note.${ext}`,
          viewer.id
        );
        voicePath = up.path;
      }
      const res = await onSubmit({
        body: body.trim(),
        visibility,
        assigneeId,
        drawing,
        voicePath,
        voiceDuration: voice ? voice.capture.duration : null,
        voicePeaks: voice ? voice.capture.peaks : null,
        attachments,
      });
      if (res && "error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      // Reset for the next note but keep the panel open — reviewers usually
      // leave several in a row.
      setBody("");
      setAttachments([]);
      setVoice(null);
      setAssigneeId(null);
      onClearDrawing();
      onCancelReply();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-accent/60 bg-card shadow-[0_0_0_1px_rgba(124,92,255,0.15),0_12px_32px_-12px_rgba(0,0,0,0.8)]">
      {/* Header: what this comment is anchored to */}
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-sm font-medium">{replyingTo ? "Reply" : "Comment"}</span>
        {stamp ? (
          <span className="rounded bg-raised px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
            {stamp}
          </span>
        ) : null}
        {drawing?.strokes.length ? (
          <button
            type="button"
            onClick={onClearDrawing}
            className="flex items-center gap-1 rounded bg-accent-ghost px-1.5 py-0.5 text-[11px] text-accent-hi hover:bg-accent/25"
            title="Remove drawing"
          >
            <IconDraw size={11} />
            Drawing attached
            <IconX size={10} />
          </button>
        ) : null}
        {replyingTo ? (
          <span className="truncate text-[11px] text-ink-3">
            to {displayName(replyingTo.author)}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close composer"
          className="ml-auto rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
        >
          <IconX size={14} />
        </button>
      </div>

      <div className="space-y-2 p-3">
        {recording ? (
          <>
            <VoiceRecorder
              onDone={onVoiceDone}
              onCancel={() => {
                setRecording(false);
                onRecordingChange(null);
              }}
              onStarted={onRecordingChange}
            />
            <p className="px-0.5 text-[11px] text-ink-3">
              Draw on the frame while you talk — the annotation replays in time with your voice.
            </p>
          </>
        ) : null}

        {screenRec ? (
          <ScreenRecorder onDone={onScreenDone} onCancel={() => setScreenRec(false)} />
        ) : null}

        {voice ? (
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <VoicePlayer
                src={voice.url}
                duration={voice.capture.duration}
                peaks={voice.capture.peaks}
                compact
              />
            </div>
            <button
              type="button"
              onClick={() => setVoice(null)}
              aria-label="Remove recording"
              className="rounded p-1.5 text-ink-3 hover:bg-hover hover:text-ink"
            >
              <IconX size={14} />
            </button>
          </div>
        ) : null}

        <div className="relative">
          <textarea
            ref={textarea}
            value={body}
            rows={2}
            autoFocus
            placeholder={voice ? "Add a note (optional)…" : "Leave a comment…  @ to mention"}
            onChange={(e) => {
              setBody(e.target.value);
              // Open the mention menu while an "@token" is being typed.
              const upto = e.target.value.slice(0, e.target.selectionStart);
              setMenu(/@[\w.-]*$/.test(upto) ? "mention" : null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
              if (e.key === "Escape") setMenu(null);
            }}
            className="w-full resize-none rounded-lg bg-raised px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none"
          />

          {menu === "mention" ? (
            <div className="absolute bottom-full left-0 z-30 mb-1 max-h-48 w-56 overflow-y-auto rounded-lg border border-line bg-raised py-1 shadow-xl">
              {roster.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => insertMention(p)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-hover"
                >
                  <Avatar person={p} size="sm" />
                  <span className="truncate">{displayName(p)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {attachments.length ? (
          <div className="flex flex-wrap gap-1.5">
            {attachments.map((a) => (
              <span
                key={a.path}
                className="flex items-center gap-1.5 rounded-md bg-raised px-2 py-1 text-[11px] text-ink-2"
              >
                <IconFile size={11} />
                <span className="max-w-32 truncate">{a.name}</span>
                <span className="text-ink-3">{fileSize(a.size)}</span>
                <button
                  type="button"
                  onClick={() => setAttachments((p) => p.filter((x) => x.path !== a.path))}
                  aria-label={`Remove ${a.name}`}
                  className="text-ink-3 hover:text-danger"
                >
                  <IconX size={10} />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            title="Attach a file"
            className="rounded-md p-1.5 text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40"
          >
            <IconPaperclip size={15} />
          </button>
          <button
            type="button"
            onClick={() => setScreenRec((v) => !v)}
            disabled={uploading || recording}
            title="Record your screen — talk over the cut while you scrub it"
            className={`rounded-md p-1.5 hover:bg-hover disabled:opacity-40 ${
              screenRec ? "text-danger" : "text-ink-2 hover:text-ink"
            }`}
          >
            <IconScreenRecord size={15} />
          </button>
          <button
            type="button"
            onClick={() => setRecording((r) => !r)}
            disabled={!!voice}
            title={voice ? "Remove the current recording first" : "Record a voice note"}
            className={`rounded-md p-1.5 hover:bg-hover disabled:opacity-40 ${
              recording ? "text-danger" : "text-ink-2 hover:text-ink"
            }`}
          >
            <IconMic size={15} />
          </button>
          <button
            type="button"
            onClick={onToggleDraw}
            title="Draw on the frame"
            className={`rounded-md p-1.5 hover:bg-hover ${
              drawing_active ? "bg-accent-ghost text-accent-hi" : "text-ink-2 hover:text-ink"
            }`}
          >
            <IconDraw size={15} />
          </button>

          <span className="mx-0.5 h-4 w-px bg-line" />

          {/* Assignee */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenu(menu === "assignee" ? null : "assignee")}
              className="flex items-center gap-1.5 rounded-full bg-accent-ghost px-2 py-1 text-[11px] text-accent-hi hover:bg-accent/25"
            >
              {assignee ? (
                <>
                  <Avatar person={assignee} size="xs" />
                  <span className="max-w-24 truncate">{displayName(assignee)}</span>
                </>
              ) : (
                <span>Assign</span>
              )}
              <IconChevronDown size={11} />
            </button>
            {menu === "assignee" ? (
              <>
                <span className="fixed inset-0 z-20" onClick={() => setMenu(null)} />
                <div className="absolute bottom-full left-0 z-30 mb-1 max-h-48 w-52 overflow-y-auto rounded-lg border border-line bg-raised py-1 shadow-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setAssigneeId(null);
                      setMenu(null);
                    }}
                    className="w-full px-2.5 py-1.5 text-left text-sm text-ink-2 hover:bg-hover"
                  >
                    No one
                  </button>
                  {roster.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setAssigneeId(p.id);
                        setMenu(null);
                      }}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-hover"
                    >
                      <Avatar person={p} size="sm" />
                      <span className="truncate">{displayName(p)}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || uploading}
            aria-label="Send comment"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white transition hover:bg-accent-hi disabled:opacity-50"
          >
            <IconSend size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
