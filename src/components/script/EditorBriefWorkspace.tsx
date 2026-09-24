"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { StageMove } from "@/components/pipeline/StageMove";
import { StageBack } from "@/components/pipeline/StageBack";
import { CarouselSlides } from "@/components/script/CarouselSlides";
import { isCarouselFormat } from "@/lib/taxonomy";
import { VideoReferences } from "@/components/VideoReferences";
import { MusicPicker } from "@/components/workspace/MusicPicker";
import { ScreenRecorder, type ScreenCapture } from "@/components/workspace/ScreenRecorder";
import { VoicePlayer, VoiceRecorder, type VoiceCapture } from "@/components/workspace/Voice";
import { uploadCommentMedia } from "@/lib/upload-client";
import { sendWithProgress } from "@/lib/upload-progress";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/limits";
import { UploadStatus, type UploadState } from "@/components/ui/UploadStatus";
import { saveBriefVoiceAction } from "@/app/script-actions";
import { updateVideoAction } from "@/app/actions";
import { createFootageUploadUrlAction, registerAssetAction } from "@/app/asset-actions";
import { BriefAttachments } from "@/components/BriefAttachments";
import {
  IconCheck,
  IconFile,
  IconMic,
  IconTrash,
  IconScreenRecord,
} from "@/components/ui/icons";
import {
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  STATUS_COLOR,
  STATUS_LABELS,
  type CarouselImage,
  type MusicTrack,
  type Priority,
  type ReferenceItem,
  type Video,
  type VideoAsset,
} from "@/lib/types";

/**
 * The last stop before a video is the editors' — everything that makes the
 * handoff a fair one gets finished here: the brief (voice and written), a
 * screen recording when a note is easier shown than typed, references, the
 * track, and the priority call. Nothing here is optional in spirit, but
 * nothing blocks "Send to editors" either — the checklist is a nudge, not a
 * gate, same as Filming.
 */
export function EditorBriefWorkspace({
  video,
  assets,
  references,
  music,
  musicLibrary,
  briefVoiceUrl,
  carouselSlides,
  chat,
}: {
  video: Video;
  assets: VideoAsset[];
  references: ReferenceItem[];
  music: MusicTrack[];
  musicLibrary: MusicTrack[];
  briefVoiceUrl: string | null;
  carouselSlides: CarouselImage[];
  chat?: React.ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTrackedTransition();

  const [recording, setRecording] = useState(false);
  const [voiceUrl, setVoiceUrl] = useState(briefVoiceUrl);
  const [voiceMeta, setVoiceMeta] = useState<{ duration: number | null; peaks: number[] | null }>({
    duration: video.brief_voice_duration_seconds,
    peaks: video.brief_voice_peaks,
  });
  const [brief, setBrief] = useState(video.brief ?? "");
  const [priority, setPriority] = useState<Priority>(video.priority);
  const [screenRecording, setScreenRecording] = useState(false);
  const [clipUpload, setClipUpload] = useState<UploadState | null>(null);
  const uploadingClip = clipUpload?.phase === "uploading";
  const footageInputRef = useRef<HTMLInputElement>(null);

  const clips = assets.filter((a) => a.kind === "other");
  const hasFootage = assets.some(
    (a) => a.kind === "raw" && (a.storage_path || a.drive_url || a.external_url)
  );

  const readyChecklist = [
    { label: "Brief for editors", done: Boolean(brief.trim() || voiceUrl) },
    { label: "Music tagged", done: music.length > 0 },
    { label: "Priority set", done: true },
  ];
  const readyCount = readyChecklist.filter((c) => c.done).length;

  const onVoiceDone = async (capture: VoiceCapture) => {
    setRecording(false);
    try {
      const up = await uploadCommentMedia(capture.blob, "brief.webm", video.assigned_editor_id ?? video.id);
      const res = await saveBriefVoiceAction(video.id, {
        path: up.path,
        duration: capture.duration,
        peaks: capture.peaks,
      });
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      setVoiceUrl(URL.createObjectURL(capture.blob));
      setVoiceMeta({ duration: capture.duration, peaks: capture.peaks });
      toast.success("Brief recorded — editors will hear this exact recording, unsummarised.");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  /** Send one file to the video's attachments, with visible progress. */
  async function sendClip(blob: Blob, name: string, label: string, title: string, doneNote: string) {
    setClipUpload({ phase: "uploading", title, pct: 0, detail: name });
    const up = await createFootageUploadUrlAction(video.id, name);
    if (!up?.ok) {
      setClipUpload({ phase: "error", title, detail: up?.error ?? "Could not start the upload." });
      return;
    }
    try {
      await sendWithProgress(up.signedUrl, blob, {
        method: "PUT",
        headers: { "x-upsert": "true" },
        onProgress: (pct) => setClipUpload({ phase: "uploading", title, pct, detail: name }),
      });
      const res = await registerAssetAction({
        videoId: video.id,
        label,
        storagePath: up.path,
        sizeBytes: blob.size,
        kind: "other",
      });
      if ("error" in res && res.error) throw new Error(res.error);
      setClipUpload({ phase: "done", title, detail: doneNote });
      router.refresh();
    } catch (e) {
      setClipUpload({ phase: "error", title, detail: (e as Error).message });
    }
  }

  async function onClipDone(capture: ScreenCapture) {
    setScreenRecording(false);
    const ext = capture.mimeType.includes("mp4") ? "mp4" : "webm";
    await sendClip(
      capture.blob,
      `brief-clip.${ext}`,
      `Screen recording — ${new Date().toLocaleDateString()}`,
      "Screen recording",
      "The recording is attached to the brief."
    );
  }

  async function uploadClipFile(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      setClipUpload({
        phase: "error",
        title: "Reference file",
        detail: `${file.name} is over the ${MAX_UPLOAD_MB} MB upload limit.`,
      });
      return;
    }
    await sendClip(file, file.name, file.name, "Reference file", `${file.name} is attached to the brief.`);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/board" className="text-sm text-ink-3 hover:text-ink">
            Board
          </Link>
          <span className="text-ink-3">/</span>
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{video.title}</h1>
          <Link
            href={`/videos/${video.id}/${isCarouselFormat(video.formats) ? "script" : "film"}`}
            className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 hover:bg-hover hover:text-ink"
          >
            {isCarouselFormat(video.formats) ? "← Back to script" : "← Back to filming"}
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]"
            style={{
              color: STATUS_COLOR[video.status],
              background: `color-mix(in srgb, ${STATUS_COLOR[video.status]} 12%, transparent)`,
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[video.status] }} />
            {STATUS_LABELS[video.status]}
          </span>
          {readyChecklist.map((c) => (
            <span
              key={c.label}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] ${
                c.done ? "bg-ok/10 text-ok" : "bg-panel text-ink-3"
              }`}
            >
              {c.done ? <IconCheck size={10} /> : null}
              {c.label}
            </span>
          ))}
          <span className="ml-auto flex items-center gap-1">
            <StageBack videoId={video.id} status={video.status} carousel={isCarouselFormat(video.formats)} />
            <StageMove
              videoId={video.id}
              to="ready_to_edit"
              label={readyCount === readyChecklist.length ? "Send to editors" : `Send to editors (${readyCount}/${readyChecklist.length} ready)`}
              goTo={`/videos/${video.id}`}
            />
          </span>
        </div>
      </div>

      {isCarouselFormat(video.formats) ? (
        <CarouselSlides
          videoId={video.id}
          slides={carouselSlides}
          carouselStyle={video.carousel_style}
        />
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <section className="rounded-2xl border border-line bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Brief for the editors</h2>
            <p className="mb-2.5 text-xs leading-relaxed text-ink-3">
              Editors see this exactly as it is — the recording plays unsummarised, and the written
              brief below is theirs to read directly, not a version of the script.
            </p>

            {recording ? (
              <VoiceRecorder onDone={onVoiceDone} onCancel={() => setRecording(false)} />
            ) : voiceUrl ? (
              <div className="space-y-2">
                <VoicePlayer src={voiceUrl} duration={voiceMeta.duration} peaks={voiceMeta.peaks} />
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      startTransition(async () => {
                        const res = await saveBriefVoiceAction(video.id, null);
                        if (res?.error) toast.error(res.error);
                        else {
                          setVoiceUrl(null);
                          router.refresh();
                        }
                      })
                    }
                    className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-2 hover:text-danger"
                  >
                    <IconTrash size={12} />
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setRecording(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong py-3 text-xs text-ink-2 hover:border-accent hover:text-ink"
              >
                <IconMic size={14} />
                Record a brief for the editors
              </button>
            )}

            <textarea
              value={brief}
              rows={5}
              placeholder="Written brief — what the editor needs to know."
              onChange={(e) => setBrief(e.target.value)}
              onBlur={(e) => {
                if (e.target.value === (video.brief ?? "")) return;
                const value = e.target.value;
                startTransition(async () => {
                  const res = await updateVideoAction(video.id, { brief: value.trim() || null });
                  if (res?.error) toast.error(res.error);
                });
              }}
              className="mt-3 w-full resize-y rounded-lg bg-panel px-2.5 py-2 text-sm leading-relaxed placeholder:text-ink-3 focus:outline-none"
            />
          </section>

          <section className="rounded-2xl border border-line bg-card p-4">
            <div className="mb-2 flex items-center gap-2">
              <IconScreenRecord size={13} className="text-ink-3" />
              <h2 className="text-sm font-semibold">Screen recording</h2>
              <span className="ml-auto text-[11px] text-ink-3">
                {hasFootage ? "Footage on file" : "No raw footage yet"} ·{" "}
                <Link href={`/videos/${video.id}/film`} className="text-accent-hi hover:underline">
                  manage footage
                </Link>
              </span>
            </div>
            <p className="mb-2.5 text-xs leading-relaxed text-ink-3">
              Screen + voice, Loom-style — for showing exactly what you mean instead of describing
              it. Or drop a reference clip or screenshot straight in.
            </p>

            {clips.length ? (
              <div className="mb-3">
                <BriefAttachments videoId={video.id} assets={assets} canEdit />
              </div>
            ) : null}

            {clipUpload ? <UploadStatus state={clipUpload} className="mb-2" /> : null}
            {screenRecording ? (
              <ScreenRecorder onDone={onClipDone} onCancel={() => setScreenRecording(false)} />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={uploadingClip}
                  onClick={() => setScreenRecording(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
                >
                  <IconScreenRecord size={13} />
                  Record screen + voice
                </button>
                <button
                  type="button"
                  disabled={uploadingClip}
                  onClick={() => footageInputRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
                >
                  <IconFile size={13} />
                  Upload a clip or screenshot
                </button>
                <input
                  ref={footageInputRef}
                  type="file"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadClipFile(f);
                    e.target.value = "";
                  }}
                />
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">References</h2>
            <VideoReferences videoId={video.id} items={references} />
          </section>
        </div>

        <aside className="min-w-0 space-y-4">
          <section className="rounded-2xl border border-line bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Priority</h2>
            <p className="mb-2.5 text-xs leading-relaxed text-ink-3">
              The one place this gets set — everywhere else just shows it.
            </p>
            <select
              value={priority}
              onChange={(e) => {
                const next = e.target.value as Priority;
                setPriority(next);
                startTransition(async () => {
                  const res = await updateVideoAction(video.id, { priority: next });
                  if (res?.error) {
                    toast.error(res.error);
                    setPriority(video.priority);
                  }
                });
              }}
              className="w-full rounded-lg border border-line bg-raised px-3 py-2 text-sm focus:border-accent focus:outline-none"
            >
              {PRIORITY_ORDER.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </section>

          <MusicPicker videoId={video.id} attached={music} library={musicLibrary} canEdit />

          {chat}
        </aside>
      </div>
    </div>
  );
}
