"use client";

import { useRef, useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { createVideoAction } from "@/app/actions";
import { saveBriefVoiceAction } from "@/app/script-actions";
import { createFootageUploadUrlAction, registerAssetAction } from "@/app/asset-actions";
import { createGuestLinkAction } from "@/app/guest-actions";
import { uploadCommentMedia } from "@/lib/upload-client";
import { TaxonomyMultiSelect } from "@/components/TaxonomyMultiSelect";
import { CAROUSEL_FORMAT } from "@/lib/taxonomy";
import { VoiceRecorder, type VoiceCapture } from "@/components/workspace/Voice";
import { QR } from "@/components/ui/QR";
import { IconCamera, IconFile, IconMic, IconPlus, IconX } from "@/components/ui/icons";
import { displayName } from "@/lib/format";
import {
  STATUS_COLOR,
  STATUS_LABELS,
  type Profile,
  type VideoStatus,
} from "@/lib/types";

/** The only stages a brand-new video can start in. */
const START_STAGES: VideoStatus[] = ["ideation", "scripting", "ready_to_film", "ready_to_edit"];

const STAGE_HINT: Record<string, string> = {
  ideation: "Just an idea. Private to you — editors can't see it.",
  scripting: "Ready to be written. Still private to you.",
  ready_to_film: "Scripted already — just needs shooting.",
  ready_to_edit: "Goes straight into the editors' pool.",
};

/** Plainer labels than the pipeline's own stage names, just for this question. */
const START_LABEL: Record<string, string> = {
  ideation: "Just an idea",
  scripting: "Scripting",
  ready_to_film: "Ready to film",
  ready_to_edit: "Ready to edit",
};

/** The notes field asks a different question depending on the stage. */
const NOTES_COPY: Record<string, { label: string; placeholder: string }> = {
  ideation: { label: "Notes", placeholder: "What's the idea? Angles, why it might work…" },
  scripting: {
    label: "What do you already know?",
    placeholder: "Angle, key points, anything you've already figured out",
  },
  ready_to_film: { label: "Notes", placeholder: "Anything the shoot needs to know" },
  ready_to_edit: { label: "Brief for the editor", placeholder: "What is this video and what does it need to do?" },
};

/** Stages that already have footage in hand when they're logged. */
const FOOTAGE_STAGES: VideoStatus[] = ["ready_to_film", "ready_to_edit"];

/**
 * Where to land right after creating — the stage-specific workspace for that
 * status, not a generic form. Ideation gets the voice-note capture, Scripting gets the script editor and teleprompter, Ready to Film
 * gets the shoot-day assembly page, Ready to Edit goes straight to the
 * shared workspace since it's already handed off.
 */
const DEST_AFTER_CREATE: Record<string, (id: string) => string> = {
  ideation: (id) => `/videos/${id}/idea`,
  scripting: (id) => `/videos/${id}/script`,
  ready_to_film: (id) => `/videos/${id}/film`,
  ready_to_edit: (id) => `/videos/${id}`,
};

export function NewVideoDialog({
  open,
  onClose,
  editors = [],
  customs = { content_pillar: [], format: [], platform: [] },
  viewerId,
}: {
  open: boolean;
  onClose: () => void;
  editors?: Pick<Profile, "id" | "full_name" | "email">[];
  customs?: { content_pillar: string[]; format: string[]; platform: string[] };
  viewerId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTrackedTransition();
  const [status, setStatus] = useState<VideoStatus | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [pillars, setPillars] = useState<string[]>([]);
  const [formats, setFormats] = useState<string[]>([]);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [recording, setRecording] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [voice, setVoice] = useState<{ path: string; duration: number; peaks: number[] } | null>(
    null
  );
  const [footageFile, setFootageFile] = useState<File | null>(null);
  const [footageProgress, setFootageProgress] = useState<number | null>(null);
  const [wantsQr, setWantsQr] = useState(false);
  const [qrStep, setQrStep] = useState<{ url: string; dest: string } | null>(null);
  const footageInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function reset() {
    setStatus(null);
    setTitle("");
    setNotes("");
    setPillars([]);
    setFormats([]);
    setPlatforms([]);
    setRecording(false);
    setDrafting(false);
    setVoice(null);
    setFootageFile(null);
    setWantsQr(false);
    setQrStep(null);
  }

  async function onVoiceDone(capture: VoiceCapture) {
    setRecording(false);
    setDrafting(true);
    try {
      // Just stored with the idea — nothing is transcribed or rewritten.
      const up = await uploadCommentMedia(capture.blob, "idea.webm", viewerId);
      setVoice({ path: up.path, duration: capture.duration, peaks: capture.peaks });
      setDrafting(false);
    } catch (e) {
      setDrafting(false);
      setError((e as Error).message);
    }
  }

  if (!open) return null;

  if (qrStep) {
    return (
      <div
        role="dialog"
        aria-modal
        aria-label="Scan to upload footage"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-xs space-y-3 rounded-2xl border border-line bg-card p-5 text-center shadow-2xl"
        >
          <h2 className="text-sm font-semibold">Video created — scan to upload footage</h2>
          <div className="flex justify-center">
            <QR url={qrStep.url} />
          </div>
          <p className="text-[11px] leading-snug text-ink-3">
            Point a phone camera at this. Footage uploads straight to the editors — the phone
            never needs to be signed in.
          </p>
          <button
            type="button"
            onClick={() => {
              const dest = qrStep.dest;
              onClose();
              reset();
              router.push(dest);
            }}
            className="w-full rounded-lg bg-accent py-1.5 text-sm font-medium text-white hover:bg-accent-hi"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  const notesCopy = status ? (NOTES_COPY[status] ?? NOTES_COPY.ready_to_edit) : null;
  const canSubmit =
    status !== null &&
    (status === "ideation" || (title.trim().length > 0 && formats.length > 0));

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="New video"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-8"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        // Never bind an imported server action straight to `action` — wrap it.
        action={(fd) => {
          if (!status) return;
          setError(null);
          // Array fields don't survive uncontrolled inputs; append them here.
          for (const p of pillars) fd.append("content_pillars", p);
          for (const f of formats) fd.append("formats", f);
          for (const pl of platforms) fd.append("platforms", pl);
          startTransition(async () => {
            const res = await createVideoAction(fd);
            if (res?.error) {
              setError(res.error);
              return;
            }
            // The recording was only staged — attach it to the video now
            // that it actually exists, so it's waiting on the Idea page.
            if (res?.id && voice) await saveBriefVoiceAction(res.id, voice);
            // A phone-scanned upload needs the video to exist first — create
            // the guest link now and hold the dialog open on a QR step
            // instead of navigating straight away.
            const dest = status;
            const destHref = res?.id ? (DEST_AFTER_CREATE[dest]?.(res.id) ?? `/board?open=${res.id}`) : null;
            if (res?.id && wantsQr && !footageFile) {
              const link = await createGuestLinkAction({ videoId: res.id, purpose: "upload" });
              if ("token" in link && link.token && destHref) {
                setQrStep({ url: `${window.location.origin}/g/${link.token}`, dest: destHref });
                return;
              }
            }
            // Same for footage — best-effort, a failure here shouldn't block
            // navigating to the video that was already created successfully.
            if (res?.id && footageFile) {
              setFootageProgress(0);
              const up = await createFootageUploadUrlAction(res.id, footageFile.name);
              if (up?.ok) {
                try {
                  await new Promise<void>((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open("PUT", up.signedUrl);
                    xhr.setRequestHeader("x-upsert", "true");
                    xhr.upload.onprogress = (e) =>
                      e.lengthComputable &&
                      setFootageProgress(Math.round((e.loaded / e.total) * 100));
                    xhr.onload = () =>
                      xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`));
                    xhr.onerror = () => reject(new Error("Upload failed"));
                    xhr.send(footageFile);
                  });
                  await registerAssetAction({
                    videoId: res.id,
                    label: footageFile.name,
                    storagePath: up.path,
                    sizeBytes: footageFile.size,
                  });
                } catch {
                  /* the video still exists — footage can be added again from its page */
                }
              }
              setFootageProgress(null);
            }
            onClose();
            reset();
            // Land straight in the workspace for whichever stage it started
            // in — the idea capture, the script editor, the shoot page, or
            // (for Ready to Edit) the shared workspace — instead of a
            // generic form.
            if (destHref) router.push(destHref);
            else router.refresh();
          });
        }}
        className="w-full max-w-2xl space-y-5 rounded-2xl border border-line bg-card p-6 shadow-2xl"
      >
        <div>
          <h2 className="text-lg font-semibold">New video</h2>
          <p className="mt-0.5 text-xs text-ink-3">
            Fill in what you know now — everything here is editable later.
          </p>
        </div>

        {/* Starting stage — chosen first, since it decides what's asked below. */}
        <div>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            Where&rsquo;s the video at?
          </span>
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {START_STAGES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                aria-pressed={status === s}
                className={`rounded-xl border px-3 py-2 text-left transition ${
                  status === s
                    ? "border-accent bg-accent-ghost"
                    : "border-line bg-raised hover:border-line-strong"
                }`}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: STATUS_COLOR[s] }}
                  />
                  {START_LABEL[s]}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">
                  {STAGE_HINT[s]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {status ? (
          <>
            {status === "ideation" ? (
              <div className="space-y-2 rounded-xl border border-dashed border-line-strong bg-app p-3">
                {recording ? (
                  <VoiceRecorder onDone={onVoiceDone} onCancel={() => setRecording(false)} />
                ) : drafting ? (
                  <div className="flex items-center gap-2 py-2 text-sm text-ink-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                    Saving the recording…
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRecording(true)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm text-ink-2 transition hover:border-accent hover:text-ink"
                  >
                    <IconMic size={14} />
                    {voice ? "Re-record the idea" : "Or describe it out loud instead"}
                  </button>
                )}
                {voice && !recording && !drafting ? (
                  <p className="flex items-center gap-1.5 text-[11px] text-ink-3">
                    <IconMic size={11} />
                    Recording attached — it plays back on the idea once it&rsquo;s created.
                    <button
                      type="button"
                      onClick={() => setVoice(null)}
                      className="ml-auto flex items-center gap-0.5 text-ink-3 hover:text-danger"
                    >
                      <IconX size={11} />
                      Discard
                    </button>
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* Title + Format — the two non-negotiables. Everything below is
                detail that can change later; these two decide how the video
                actually works on the dashboard, so they get the space. */}
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                Title {status === "ideation" ? <span className="normal-case text-ink-3">(optional)</span> : null}
              </span>
              <input
                name="title"
                required={status !== "ideation"}
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What's the video?"
                className="w-full rounded-lg border border-line bg-raised px-3 py-2 text-base placeholder:text-ink-3 focus:border-accent focus:outline-none"
              />
            </label>

            <div className="rounded-xl border border-line-strong bg-app p-3">
              <TaxonomyMultiSelect
                kind="format"
                selected={formats}
                customs={customs.format}
                onChange={setFormats}
                size="lg"
              />
              {status !== "ideation" && formats.length === 0 ? (
                <p className="mt-2 text-[11px] text-ink-3">
                  Required — this decides how the video is scripted and delivered.
                </p>
              ) : formats.includes(CAROUSEL_FORMAT) ? (
                <p className="mt-2 text-[11px] text-accent-hi">
                  Carousel — the script stage will ask for slides, not a hook/body/CTA.
                </p>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                  Post date
                </span>
                <input
                  type="date"
                  name="post_date"
                  className="w-full rounded-lg border border-line bg-raised px-3 py-2 [color-scheme:dark] focus:border-accent focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                  Editor
                </span>
                <select
                  name="assigned_editor_id"
                  defaultValue=""
                  disabled={status !== "ready_to_edit"}
                  title={
                    status === "ready_to_edit"
                      ? undefined
                      : "Editors can only be assigned once it's in Ready to Edit"
                  }
                  className="w-full rounded-lg border border-line bg-raised px-3 py-2 focus:border-accent focus:outline-none disabled:opacity-40"
                >
                  <option value="">Leave in the pool</option>
                  {editors.map((e) => (
                    <option key={e.id} value={e.id}>
                      {displayName(e)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-[11px] text-ink-3">
              Priority is set later, at the Editor Brief stage — starts as Standard.
            </p>

            <div className="space-y-3">
              <TaxonomyMultiSelect
                kind="content_pillar"
                selected={pillars}
                customs={customs.content_pillar}
                onChange={setPillars}
              />
              <TaxonomyMultiSelect
                kind="platform"
                selected={platforms}
                customs={customs.platform}
                onChange={setPlatforms}
              />
            </div>

            {FOOTAGE_STAGES.includes(status) ? (
              <div>
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                  Raw footage <span className="normal-case text-ink-3">(optional)</span>
                </span>
                {wantsQr ? (
                  <div className="rounded-lg border border-dashed border-accent bg-accent-ghost px-3 py-3 text-center text-xs text-ink-2">
                    <span className="flex items-center justify-center gap-1.5">
                      <IconCamera size={13} className="text-accent-hi" />
                      You&rsquo;ll get a QR to scan and upload from a phone right after creating.
                    </span>
                    <button
                      type="button"
                      onClick={() => setWantsQr(false)}
                      className="mt-1.5 text-[11px] text-ink-3 hover:text-ink"
                    >
                      Use a file instead
                    </button>
                  </div>
                ) : (
                  <>
                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const f = e.dataTransfer.files?.[0];
                        if (f) setFootageFile(f);
                      }}
                      onClick={() => footageInputRef.current?.click()}
                      className="cursor-pointer rounded-lg border border-dashed border-line-strong px-3 py-3 text-center text-xs text-ink-2 hover:border-accent"
                    >
                      {footageFile ? (
                        <span className="flex items-center justify-center gap-1.5">
                          <IconFile size={12} />
                          {footageFile.name}
                        </span>
                      ) : (
                        "Drop the raw footage here, or click to choose"
                      )}
                      <input
                        ref={footageInputRef}
                        type="file"
                        accept="video/*"
                        hidden
                        onChange={(e) => setFootageFile(e.target.files?.[0] ?? null)}
                      />
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      {footageFile ? (
                        <button
                          type="button"
                          onClick={() => setFootageFile(null)}
                          className="text-[11px] text-ink-3 hover:text-danger"
                        >
                          Remove
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setWantsQr(true)}
                        className="ml-auto flex items-center gap-1 text-[11px] text-ink-3 hover:text-ink"
                      >
                        <IconCamera size={11} />
                        Or scan a QR to upload from a phone instead
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : null}

            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                {notesCopy?.label} <span className="normal-case text-ink-3">(optional)</span>
              </span>
              <textarea
                name="brief"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={notesCopy?.placeholder}
                className="w-full resize-none rounded-lg border border-line bg-raised px-3 py-2 placeholder:text-ink-3 focus:border-accent focus:outline-none"
              />
            </label>
          </>
        ) : (
          <p className="rounded-lg border border-dashed border-line-strong px-3 py-6 text-center text-xs text-ink-3">
            Pick a stage above to continue.
          </p>
        )}

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-hover"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit || pending || recording || drafting}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hi disabled:opacity-60"
          >
            {pending
              ? footageProgress !== null
                ? `Uploading footage… ${footageProgress}%`
                : "Creating…"
              : status
                ? `Create in ${STATUS_LABELS[status]}`
                : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function CreateVideoButton({
  editors = [],
  customs,
  viewerId,
}: {
  editors?: Pick<Profile, "id" | "full_name" | "email">[];
  customs?: { content_pillar: string[]; format: string[]; platform: string[] };
  viewerId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hi"
      >
        New video
        <IconPlus size={14} />
      </button>
      <NewVideoDialog
        open={open}
        onClose={() => setOpen(false)}
        editors={editors}
        customs={customs}
        viewerId={viewerId}
      />
    </>
  );
}
