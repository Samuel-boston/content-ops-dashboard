"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { TaxonomyMultiSelect } from "@/components/TaxonomyMultiSelect";
import { VideoReferences } from "@/components/VideoReferences";
import { VoicePlayer, VoiceRecorder, type VoiceCapture } from "@/components/workspace/Voice";
import { PlanningStageBar } from "@/components/pipeline/PlanningStageBar";
import { IconMic, IconSparkles, IconTrash } from "@/components/ui/icons";
import { saveBriefVoiceAction, saveIdeaNotesAction, transcribeBriefAction } from "@/app/script-actions";
import { suggestTagsAction } from "@/app/ai-actions";
import { updateVideoAction } from "@/app/actions";
import { uploadCommentMedia } from "@/lib/upload-client";
import type { Profile, ReferenceItem, Video } from "@/lib/types";

/**
 * The idea shelf, opened up.
 *
 * Clicking an idea used to drop you into the script editor — hooks, body, CTA,
 * a read-time counter — which is a set of questions you can't answer yet. An
 * idea at this stage is a sentence and a hunch. So this is a page for thinking:
 * a big empty box, a voice recorder for when typing is too slow, and the tags
 * you already know. The script editor is one click away, and it appears the
 * moment you say the idea is worth writing.
 */
export function IdeaWorkspace({
  video,
  viewer,
  customs,
  briefVoiceUrl,
  references,
}: {
  video: Video;
  viewer: Profile;
  customs: { content_pillar: string[]; format: string[]; platform: string[] };
  briefVoiceUrl: string | null;
  references: ReferenceItem[];
}) {
  const toast = useToast();
  const router = useRouter();
  const [, startTransition] = useTrackedTransition();

  const [notes, setNotes] = useState(video.idea_notes ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceUrl, setVoiceUrl] = useState(briefVoiceUrl);
  const [voiceMeta, setVoiceMeta] = useState<{ duration: number | null; peaks: number[] | null }>({
    duration: video.brief_voice_duration_seconds,
    peaks: video.brief_voice_peaks,
  });
  const [suggestingTags, setSuggestingTags] = useState(false);

  const canEdit = viewer.role === "owner" || viewer.role === "admin";

  function suggestTags() {
    setSuggestingTags(true);
    startTransition(async () => {
      const res = await suggestTagsAction(video.id);
      setSuggestingTags(false);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      if (res?.ok) {
        const patch = {
          content_pillars: [...new Set([...video.content_pillars, ...res.pillars])],
          formats: [...new Set([...video.formats, ...res.formats])],
          platforms: [...new Set([...video.platforms, ...res.platforms])],
        };
        if (!patch.content_pillars.length && !patch.formats.length && !patch.platforms.length) {
          toast.error("Nothing clear enough to suggest yet — add a bit more to the idea first.");
          return;
        }
        await updateVideoAction(video.id, patch);
        router.refresh();
        toast.success("Tags suggested — check them below.");
      }
    });
  }

  const save = useCallback(
    (value: string) => {
      setSaving(true);
      startTransition(async () => {
        const res = await saveIdeaNotesAction(video.id, value);
        setSaving(false);
        if (res?.error) toast.error(res.error);
        else setDirty(false);
      });
    },
    [video.id, toast, startTransition]
  );

  const onVoiceDone = useCallback(
    async (capture: VoiceCapture) => {
      setRecording(false);
      try {
        const up = await uploadCommentMedia(capture.blob, "brief.webm", viewer.id);
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
        toast.success("Idea recorded.");
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [video.id, viewer.id, toast, router]
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/ideation" className="text-sm text-ink-3 hover:text-ink">
              Ideation
            </Link>
            <span className="text-ink-3">/</span>
            <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{video.title}</h1>
          </div>
          <PlanningStageBar videoId={video.id} current={video.status} canEdit={canEdit} />
        </div>

        <section className="rounded-2xl border border-line bg-card p-4">
          <div className="mb-2 flex items-baseline gap-2">
            <h2 className="text-sm font-semibold">Thinking</h2>
            <span className="ml-auto text-[11px] text-ink-3">
              {saving ? "Saving…" : dirty ? "Unsaved" : "Saved"}
            </span>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-ink-3">
            Nothing here has to be good. Angles, references, a line you overheard, why this might
            not work. It all carries through to the script when you&rsquo;re ready.
          </p>
          <textarea
            value={notes}
            rows={20}
            placeholder="What&rsquo;s the idea?"
            onChange={(e) => {
              setNotes(e.target.value);
              setDirty(true);
            }}
            onBlur={() => dirty && save(notes)}
            className="w-full resize-y bg-transparent text-sm leading-relaxed placeholder:text-ink-3 focus:outline-none"
          />
        </section>
      </div>

      <aside className="space-y-4">
        <section className="rounded-2xl border border-line bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Talk it out</h2>
          <p className="mb-2.5 text-xs leading-relaxed text-ink-3">
            Quicker than typing when the idea is still forming. Turn it into text whenever.
          </p>

          {recording ? (
            <VoiceRecorder onDone={onVoiceDone} onCancel={() => setRecording(false)} />
          ) : voiceUrl ? (
            <div className="space-y-2">
              <VoicePlayer src={voiceUrl} duration={voiceMeta.duration} peaks={voiceMeta.peaks} />
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={transcribing}
                  onClick={() => {
                    setTranscribing(true);
                    startTransition(async () => {
                      const res = await transcribeBriefAction(video.id);
                      setTranscribing(false);
                      if (res?.error) toast.error(res.error);
                      else if (res?.text) {
                        const next = notes ? `${notes}\n\n${res.text}` : res.text;
                        setNotes(next);
                        save(next);
                        toast.success("Added to your notes.");
                      }
                    });
                  }}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-accent-hi disabled:opacity-50"
                >
                  <IconSparkles size={12} />
                  {transcribing ? "Transcribing…" : "Turn into text"}
                </button>
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
              Record the idea
            </button>
          )}
        </section>

        <section className="rounded-2xl border border-line bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">References</h2>
          <p className="mb-2.5 text-xs leading-relaxed text-ink-3">
            Anything that shaped the idea — a video you liked, a screenshot, a link.
          </p>
          <VideoReferences videoId={video.id} items={references} />
        </section>

        <section className="space-y-3 rounded-2xl border border-line bg-card p-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Where it fits</h2>
            <button
              type="button"
              disabled={suggestingTags}
              title="Suggests from your notes — only ever picks from the real preset lists, never invents one"
              onClick={suggestTags}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-accent hover:text-ink disabled:opacity-40"
            >
              <IconSparkles size={11} />
              {suggestingTags ? "Reading…" : "Suggest tags"}
            </button>
          </div>
          <p className="text-[11px] leading-snug text-ink-3">
            Optional now — but tagging early is what makes the analytics worth reading later.
          </p>
          <TaxonomyMultiSelect
            kind="content_pillar"
            selected={video.content_pillars}
            customs={customs.content_pillar}
            onChange={(content_pillars) =>
              startTransition(async () => {
                await updateVideoAction(video.id, { content_pillars });
                router.refresh();
              })
            }
          />
          <TaxonomyMultiSelect
            kind="format"
            selected={video.formats}
            customs={customs.format}
            onChange={(formats) =>
              startTransition(async () => {
                await updateVideoAction(video.id, { formats });
                router.refresh();
              })
            }
          />
          <TaxonomyMultiSelect
            kind="platform"
            selected={video.platforms}
            customs={customs.platform}
            onChange={(platforms) =>
              startTransition(async () => {
                await updateVideoAction(video.id, { platforms });
                router.refresh();
              })
            }
          />
        </section>
      </aside>
    </div>
  );
}
