"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { IconPause, IconPlay, IconTrash, IconX } from "@/components/ui/icons";
import { timecode } from "@/lib/format";

export interface ScreenCapture {
  blob: Blob;
  duration: number;
  mimeType: string;
}

/** The first container the browser will actually give us, best first. */
const CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
}

/**
 * Five minutes at 1 Mbps lands around 37 MB, which clears the 50 MB storage
 * ceiling with room to spare. An edit note that needs longer than five minutes
 * is a conversation, not a comment.
 */
const MAX_SECONDS = 5 * 60;
const VIDEO_BITRATE = 1_000_000;

/**
 * Loom, pinned to the timeline.
 *
 * Explaining an edit note out loud while scrubbing takes twenty seconds; typing
 * the same note takes five minutes and lands worse. The recording captures the
 * screen and the microphone together, so the cut, the playhead and the voice
 * arrive as one artefact — and it posts as an ordinary comment, stamped at the
 * frame the recording started on.
 *
 * Screen capture is a browser-level permission prompt: the user picks the tab
 * or window themselves, and we never see anything they didn't choose. Stopping
 * the share from Chrome's own bar also ends the recording, which is why the
 * track's `ended` event is wired up as well as the stop button.
 */
export function ScreenRecorder({
  onDone,
  onCancel,
}: {
  onDone: (capture: ScreenCapture) => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const streams = useRef<MediaStream[]>([]);
  const startedAt = useRef(0);
  const pausedFor = useRef(0);
  const pausedAt = useRef(0);

  const [state, setState] = useState<"idle" | "recording" | "paused" | "review">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [preview, setPreview] = useState<{ url: string; capture: ScreenCapture } | null>(null);

  const stopTracks = useCallback(() => {
    for (const s of streams.current) s.getTracks().forEach((t) => t.stop());
    streams.current = [];
  }, []);

  // Tick the counter while running.
  useEffect(() => {
    if (state !== "recording") return;
    const id = setInterval(() => {
      setElapsed((performance.now() - startedAt.current - pausedFor.current) / 1000);
    }, 200);
    return () => clearInterval(id);
  }, [state]);

  // Auto-stop at the cap.
  useEffect(() => {
    if (state === "recording" && elapsed >= MAX_SECONDS) {
      recorder.current?.stop();
      toast.error("Five-minute limit reached — recording stopped.");
    }
  }, [state, elapsed, toast]);

  useEffect(() => stopTracks, [stopTracks]);

  const start = useCallback(async () => {
    const mimeType = pickMime();
    if (!navigator.mediaDevices?.getDisplayMedia || !mimeType) {
      toast.error("This browser can't record the screen. Safari and most mobiles can't yet.");
      onCancel();
      return;
    }

    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        // Tab audio when the picker offers it — that's the cut's own sound.
        audio: true,
      });
    } catch {
      // Almost always the user dismissing the picker. Not an error worth shouting about.
      onCancel();
      return;
    }
    streams.current.push(display);

    // The microphone is a separate stream: the display picker may or may not
    // include audio, and the voiceover is the part that must never be missing.
    let mic: MediaStream | null = null;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      streams.current.push(mic);
    } catch {
      toast.error("Recording without a microphone — we couldn't get access to it.");
    }

    // Mix the two audio sources so the result is a single track.
    const tracks = [...display.getVideoTracks()];
    const displayAudio = display.getAudioTracks();
    const micAudio = mic?.getAudioTracks() ?? [];

    if (displayAudio.length && micAudio.length) {
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(new MediaStream(displayAudio)).connect(dest);
      ctx.createMediaStreamSource(new MediaStream(micAudio)).connect(dest);
      tracks.push(...dest.stream.getAudioTracks());
    } else {
      tracks.push(...displayAudio, ...micAudio);
    }

    const combined = new MediaStream(tracks);
    const rec = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: VIDEO_BITRATE });
    recorder.current = rec;
    chunks.current = [];
    pausedFor.current = 0;

    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.current.push(e.data);
    };
    rec.onstop = () => {
      const duration = (performance.now() - startedAt.current - pausedFor.current) / 1000;
      stopTracks();
      const blob = new Blob(chunks.current, { type: mimeType });
      if (blob.size === 0) {
        toast.error("Nothing was captured.");
        onCancel();
        return;
      }
      const capture = { blob, duration, mimeType };
      setPreview({ url: URL.createObjectURL(blob), capture });
      setState("review");
    };

    // Ending the share from the browser's own bar must end the recording too.
    display.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (recorder.current?.state !== "inactive") recorder.current?.stop();
    });

    startedAt.current = performance.now();
    rec.start(1000);
    setState("recording");
    setElapsed(0);
  }, [onCancel, stopTracks, toast]);

  // Open the picker as soon as the panel mounts — one click, not two.
  // Deferred a tick so the state changes inside `start` land outside the
  // effect body rather than cascading a second render out of the first. The
  // browser's user-activation window is seconds long, so the picker still
  // counts as opened by the click that mounted this panel.
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      if (!cancelled) void start();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "review" && preview) {
    return (
      <div className="space-y-2 rounded-xl border border-accent bg-panel p-2.5">
        <video src={preview.url} controls className="max-h-56 w-full rounded-lg bg-black" />
        <div className="flex items-center gap-2">
          <span className="text-[11px] tabular-nums text-ink-3">
            {timecode(preview.capture.duration)} recorded
          </span>
          <button
            type="button"
            onClick={() => {
              URL.revokeObjectURL(preview.url);
              setPreview(null);
              onCancel();
            }}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-3 hover:text-danger"
          >
            <IconTrash size={11} />
            Discard
          </button>
          <button
            type="button"
            onClick={() => onDone(preview.capture)}
            className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:bg-accent-hi"
          >
            Use it
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border border-danger/40 bg-danger/5 px-3 py-2.5">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        {state === "recording" ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-60" />
        ) : null}
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-danger" />
      </span>

      <span className="text-xs tabular-nums text-ink">
        {state === "idle" ? "Choose what to share…" : timecode(elapsed)}
      </span>
      {state === "paused" ? <span className="text-[11px] text-ink-3">Paused</span> : null}

      <span className="ml-auto flex items-center gap-1.5">
        {state === "recording" || state === "paused" ? (
          <>
            <button
              type="button"
              onClick={() => {
                const rec = recorder.current;
                if (!rec) return;
                if (rec.state === "recording") {
                  rec.pause();
                  pausedAt.current = performance.now();
                  setState("paused");
                } else {
                  rec.resume();
                  pausedFor.current += performance.now() - pausedAt.current;
                  setState("recording");
                }
              }}
              aria-label={state === "paused" ? "Resume recording" : "Pause recording"}
              className="rounded-lg border border-line px-2 py-1.5 text-ink-2 hover:text-ink"
            >
              {state === "paused" ? <IconPlay size={12} /> : <IconPause size={12} />}
            </button>
            <button
              type="button"
              onClick={() => recorder.current?.stop()}
              className="rounded-lg bg-danger px-3 py-1.5 text-[11px] font-medium text-white hover:opacity-90"
            >
              Stop
            </button>
          </>
        ) : null}
        <button
          type="button"
          onClick={() => {
            if (recorder.current?.state !== "inactive") recorder.current?.stop();
            stopTracks();
            onCancel();
          }}
          aria-label="Cancel recording"
          className="rounded-lg p-1.5 text-ink-3 hover:bg-hover hover:text-ink"
        >
          <IconX size={13} />
        </button>
      </span>
    </div>
  );
}
