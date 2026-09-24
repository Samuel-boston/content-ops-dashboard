"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { StageMove } from "@/components/pipeline/StageMove";
import { StageBack } from "@/components/pipeline/StageBack";
import { Teleprompter } from "@/components/script/Teleprompter";
import { VideoFootage } from "@/components/VideoFootage";
import { ShareLinks } from "@/components/workspace/ShareLinks";
import { VoicePlayer, VoiceRecorder, type VoiceCapture } from "@/components/workspace/Voice";
import { uploadCommentMedia } from "@/lib/upload-client";
import { saveBriefVoiceAction } from "@/app/script-actions";
import { updateVideoAction } from "@/app/actions";
import { IconChart, IconCheck, IconFile, IconMic, IconTrash } from "@/components/ui/icons";
import { STATUS_COLOR, STATUS_LABELS } from "@/lib/types";
import type { GuestLink, Video, VideoAsset } from "@/lib/types";
import { ParkButton } from "@/components/pipeline/ParkButton";
import { ThumbnailPanel } from "@/components/workspace/ThumbnailPanel";

/**
 * The assembly step between "script done" and "sent to editors" — everything
 * that needs to exist before a video is a fair brief: the footage and the
 * brief itself, spoken or written. Not a new pipeline stage in the database
 * (that's a large, risky change for what's really a UI gap) — `ready_to_film`
 * already covers this window; this page is what "Script done — ready to
 * film" now opens onto instead of a list. Music and references were pulled
 * out — they're not decisions this stage needs to make.
 */
export function FilmingWorkspace({
  video,
  assets,
  driveConfigured,
  briefVoiceUrl,
  guestLinks,
  chat,
}: {
  video: Video;
  assets: VideoAsset[];
  driveConfigured: boolean;
  briefVoiceUrl: string | null;
  guestLinks: GuestLink[];
  chat?: React.ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTrackedTransition();

  const [prompting, setPrompting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceUrl, setVoiceUrl] = useState(briefVoiceUrl);
  const [voiceMeta, setVoiceMeta] = useState<{ duration: number | null; peaks: number[] | null }>({
    duration: video.brief_voice_duration_seconds,
    peaks: video.brief_voice_peaks,
  });
  const [brief, setBrief] = useState(video.brief ?? "");

  const hasScript = Boolean(video.script_body?.trim() || video.script_hooks?.length);
  const hasFootage = assets.some((a) => a.storage_path || a.drive_url || a.external_url);
  const readyChecklist = [
    { label: "Script written", done: hasScript },
    { label: "Raw footage added", done: hasFootage },
    { label: "Brief for editors", done: Boolean(brief.trim() || voiceUrl) },
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

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/filming" className="text-sm text-ink-3 hover:text-ink">
            Filming
          </Link>
          <span className="text-ink-3">/</span>
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{video.title}</h1>
          <ParkButton videoId={video.id} parked={Boolean(video.parked_at)} compact />
          <Link
            href={`/videos/${video.id}/script`}
            className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 hover:bg-hover hover:text-ink"
          >
            ← Back to script
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
            <StageBack videoId={video.id} status={video.status} />
            <StageMove
              videoId={video.id}
              to="editor_brief"
              label={readyCount === readyChecklist.length ? "Build the editor brief" : `Build the editor brief (${readyCount}/${readyChecklist.length} ready)`}
              goTo={`/videos/${video.id}/editor-brief`}
            />
          </span>
        </div>
      </div>

      <ThumbnailPanel videoId={video.id} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <section className="rounded-2xl border border-line bg-card p-4">
            <div className="mb-2 flex items-center gap-2">
              <IconFile size={13} className="text-ink-3" />
              <h2 className="text-sm font-semibold">Script</h2>
              <Link
                href={`/videos/${video.id}/script`}
                className="ml-auto text-[11px] text-accent-hi hover:underline"
              >
                Edit script →
              </Link>
            </div>
            {!hasScript ? (
              <p className="rounded-lg bg-panel px-3 py-2.5 text-xs text-ink-3">
                No script yet — go back and write one before filming.
              </p>
            ) : (
              <div className="space-y-2 text-sm">
                {video.script_hooks?.[0] ? (
                  <p className="rounded-lg bg-panel px-2.5 py-2 leading-snug">
                    <span className="mr-1.5 text-[10px] uppercase tracking-wider text-ink-3">Hook</span>
                    {video.script_hooks[0]}
                  </p>
                ) : null}
                {video.script_body ? (
                  <p className="whitespace-pre-wrap rounded-lg bg-panel px-2.5 py-2 leading-relaxed text-ink-2">
                    {video.script_body}
                  </p>
                ) : null}
              </div>
            )}
            <button
              type="button"
              onClick={() => setPrompting(true)}
              disabled={!hasScript}
              className="mt-3 flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 transition hover:border-accent hover:text-ink disabled:opacity-40"
            >
              <IconChart size={13} />
              Teleprompter
            </button>
          </section>

          <section className="space-y-4 rounded-2xl border border-line bg-card p-4">
            <div>
              <h2 className="mb-2 text-sm font-semibold">Raw footage</h2>
              <VideoFootage videoId={video.id} assets={assets} driveConfigured={driveConfigured} />
            </div>
            <div className="border-t border-line pt-3">
              <ShareLinks videoId={video.id} links={guestLinks} canManage uploadOnly />
            </div>
          </section>
        </div>

        <aside className="min-w-0 space-y-4">
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

          {chat}
        </aside>
      </div>

      {prompting ? (
        <Teleprompter
          hooks={video.script_hooks ?? []}
          body={video.script_body ?? ""}
          onClose={() => setPrompting(false)}
        />
      ) : null}
    </div>
  );
}
