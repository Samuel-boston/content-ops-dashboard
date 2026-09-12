"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { VoiceRecorder, type VoiceCapture } from "@/components/workspace/Voice";
import { uploadCommentMedia } from "@/lib/upload-client";
import { IconCheck, IconMic, IconSparkles, IconX } from "@/components/ui/icons";
import {
  createIdeaFromVoiceDraftAction,
  draftIdeaFromRecordingAction,
} from "@/app/ai-actions";

type Draft = {
  title: string;
  brief: string;
  hook: string;
  pillar: string;
  musicMood: string;
};

/**
 * Describe an idea out loud instead of typing it — this is the richest
 * intake path: title, brief, an opening hook, the pillar, and a music mood,
 * all drafted from one recording, shown for review before anything saves.
 */
export function IdeaVoiceCapture({ viewerId }: { viewerId: string }) {
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [voice, setVoice] = useState<{ path: string; duration: number; peaks: number[] } | null>(
    null
  );
  const [draft, setDraft] = useState<Draft | null>(null);

  function reset() {
    setOpen(false);
    setDrafting(false);
    setVoice(null);
    setDraft(null);
  }

  async function onVoiceDone(capture: VoiceCapture) {
    setDrafting(true);
    try {
      const up = await uploadCommentMedia(capture.blob, "idea.webm", viewerId);
      const voiceInfo = { path: up.path, duration: capture.duration, peaks: capture.peaks };
      setVoice(voiceInfo);
      const res = await draftIdeaFromRecordingAction(up.path);
      setDrafting(false);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      if (res?.ok) {
        setDraft({
          title: res.title,
          brief: res.brief,
          hook: res.hook,
          pillar: res.pillar,
          musicMood: res.musicMood,
        });
      }
    } catch (e) {
      setDrafting(false);
      toast.error((e as Error).message);
    }
  }

  async function save() {
    if (!draft || !voice) return;
    setSaving(true);
    const res = await createIdeaFromVoiceDraftAction({ ...draft, voice });
    setSaving(false);
    if (res?.error) toast.error(res.error);
    else if (res?.ok) {
      toast.success(`Added "${draft.title}" to Ideation.`);
      reset();
      router.refresh();
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 transition hover:border-accent hover:text-ink"
      >
        <IconMic size={14} />
        Record an idea
      </button>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={reset} />
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-card p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Record an idea</h2>
          <button
            type="button"
            onClick={reset}
            aria-label="Close"
            className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
          >
            <IconX size={14} />
          </button>
        </div>

        {!voice ? (
          <>
            <p className="mb-3 text-xs leading-relaxed text-ink-3">
              Describe the video — what it is, what it needs to say. AI drafts a title, brief,
              opening hook, pillar and music mood from it, for you to review before it saves.
            </p>
            <VoiceRecorder onDone={onVoiceDone} onCancel={reset} />
          </>
        ) : drafting ? (
          <div className="flex items-center gap-2 py-6 text-sm text-ink-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            Transcribing and drafting…
          </div>
        ) : draft ? (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                Title
              </span>
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className="w-full rounded-lg border border-line bg-raised px-2.5 py-1.5 text-sm focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                Brief
              </span>
              <textarea
                value={draft.brief}
                rows={3}
                onChange={(e) => setDraft({ ...draft, brief: e.target.value })}
                className="w-full resize-y rounded-lg border border-line bg-raised px-2.5 py-1.5 text-sm leading-relaxed focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                Opening hook
              </span>
              <input
                value={draft.hook}
                onChange={(e) => setDraft({ ...draft, hook: e.target.value })}
                className="w-full rounded-lg border border-line bg-raised px-2.5 py-1.5 text-sm focus:outline-none"
              />
            </label>
            <div className="flex items-center gap-3 text-[11px] text-ink-3">
              <span className="rounded bg-hover px-1.5 py-0.5">{draft.pillar}</span>
              {draft.musicMood ? (
                <span className="rounded bg-hover px-1.5 py-0.5">🎵 {draft.musicMood}</span>
              ) : null}
              <span className="ml-auto flex items-center gap-1">
                <IconSparkles size={11} />
                Review before saving
              </span>
            </div>
            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <button
                type="button"
                onClick={reset}
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:bg-hover"
              >
                Discard
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={save}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hi disabled:opacity-60"
              >
                <IconCheck size={12} />
                {saving ? "Adding…" : "Add to Ideation"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
