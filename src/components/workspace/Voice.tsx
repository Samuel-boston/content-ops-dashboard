"use client";

import { useEffect, useRef, useState } from "react";
import { IconMic, IconPause, IconPlay, IconTrash } from "@/components/ui/icons";
import { timecode } from "@/lib/format";

export interface VoiceCapture {
  blob: Blob;
  duration: number;
  /** Amplitude samples 0..1, ~10/second. */
  peaks: number[];
}

/** Resample an arbitrary-length peak array down to `bars` values. */
function toBars(peaks: number[], bars: number): number[] {
  if (!peaks.length) return new Array(bars).fill(0.08);
  const out: number[] = [];
  const per = peaks.length / bars;
  for (let i = 0; i < bars; i += 1) {
    const from = Math.floor(i * per);
    const to = Math.max(from + 1, Math.floor((i + 1) * per));
    let peak = 0;
    for (let j = from; j < to && j < peaks.length; j += 1) peak = Math.max(peak, peaks[j]);
    // Floor so silence still shows a hairline rather than nothing.
    out.push(Math.max(0.08, peak));
  }
  return out;
}

function Waveform({
  peaks,
  progress,
  bars = 38,
  className = "",
}: {
  peaks: number[];
  /** 0..1 — bars before this point render as "played". */
  progress?: number;
  bars?: number;
  className?: string;
}) {
  const values = toBars(peaks, bars);
  return (
    <span className={`flex h-5 items-center gap-[2px] ${className}`}>
      {values.map((v, i) => {
        const played = progress != null && i / values.length <= progress;
        return (
          <span
            key={i}
            className={`w-[2px] shrink-0 rounded-full transition-colors ${
              played ? "bg-accent" : "bg-ink-3"
            }`}
            style={{ height: `${Math.round(v * 100)}%` }}
          />
        );
      })}
    </span>
  );
}

/**
 * Records a voice note from the mic, sampling amplitude as it goes so the
 * waveform is available immediately on stop — no decode pass needed.
 */
export function VoiceRecorder({
  onDone,
  onCancel,
  onStarted,
}: {
  onDone: (capture: VoiceCapture) => void;
  onCancel: () => void;
  /** performance.now() at the moment recording began — lets strokes be stamped. */
  onStarted?: (at: number) => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const raf = useRef<number>(0);
  const peaksRef = useRef<number[]>([]);
  const startedAt = useRef(0);
  // Set when the user cancels, so the stop handler knows to discard.
  const aborted = useRef(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = media;

        // Amplitude metering, sampled ~10x/second into peaksRef.
        const ctx = new AudioContext();
        audioCtx.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(media).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        let lastSample = 0;

        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          const now = performance.now();
          if (now - lastSample >= 100) {
            lastSample = now;
            let sum = 0;
            for (let i = 0; i < buf.length; i += 1) {
              const v = (buf[i] - 128) / 128;
              sum += v * v;
            }
            // RMS, lifted a little so normal speech fills the bar height.
            const rms = Math.min(1, Math.sqrt(sum / buf.length) * 2.5);
            peaksRef.current.push(rms);
            setPeaks([...peaksRef.current]);
          }
          setElapsed((performance.now() - startedAt.current) / 1000);
          raf.current = requestAnimationFrame(tick);
        };

        const mr = new MediaRecorder(media);
        recorder.current = mr;
        mr.ondataavailable = (e) => {
          if (e.data.size) chunks.current.push(e.data);
        };
        mr.onstop = () => {
          const duration = (performance.now() - startedAt.current) / 1000;
          media.getTracks().forEach((t) => t.stop());
          void ctx.close();
          cancelAnimationFrame(raf.current);
          if (aborted.current) return;
          onDone({
            blob: new Blob(chunks.current, { type: mr.mimeType || "audio/webm" }),
            duration,
            peaks: peaksRef.current,
          });
        };

        startedAt.current = performance.now();
        onStarted?.(startedAt.current);
        mr.start();
        raf.current = requestAnimationFrame(tick);
      } catch {
        setError("Microphone unavailable — check the browser's permission for this site.");
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf.current);
      // Unmounting mid-recording must not leave the mic light on.
      if (recorder.current?.state === "recording") {
        aborted.current = true;
        recorder.current.stop();
      }
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, [onDone, onStarted]);

  const stop = () => recorder.current?.stop();
  const cancel = () => {
    aborted.current = true;
    recorder.current?.stop();
    onCancel();
  };

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
        <span className="flex-1">{error}</span>
        <button type="button" onClick={onCancel} className="underline">
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2">
      <span className="recording flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-danger text-white">
        <IconMic size={13} />
      </span>
      <Waveform peaks={peaks} className="flex-1" bars={30} />
      <span className="font-mono text-xs tabular-nums text-ink-2">{timecode(elapsed)}</span>
      <button
        type="button"
        onClick={cancel}
        title="Discard recording"
        className="rounded p-1 text-ink-2 hover:bg-hover hover:text-ink"
      >
        <IconTrash size={14} />
      </button>
      <button
        type="button"
        onClick={stop}
        className="rounded-md bg-danger px-2.5 py-1 text-xs font-medium text-white hover:brightness-110"
      >
        Stop
      </button>
    </div>
  );
}

/** Playback for a recorded note — waveform scrubs as it plays. */
export function VoicePlayer({
  src,
  duration,
  peaks,
  compact = false,
  onTime,
}: {
  src: string;
  duration: number | null;
  peaks: number[] | null;
  compact?: boolean;
  /** Playback position, so a timed drawing can replay alongside. */
  onTime?: (t: number) => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  // Fallback for notes recorded before duration was stored; filled from
  // metadata rather than read off the ref during render.
  const [loaded, setLoaded] = useState(0);

  const total = duration || loaded;

  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg border border-line bg-raised px-2.5 ${
        compact ? "py-1.5" : "py-2"
      }`}
    >
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) setLoaded(d);
        }}
        onTimeUpdate={(e) => {
          setAt(e.currentTarget.currentTime);
          onTime?.(e.currentTarget.currentTime);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setAt(0);
          onTime?.(0);
        }}
      />
      <button
        type="button"
        onClick={() => {
          const el = audio.current;
          if (!el) return;
          if (el.paused) void el.play();
          else el.pause();
        }}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-white hover:bg-accent-hi"
      >
        {playing ? <IconPause size={12} /> : <IconPlay size={12} />}
      </button>
      <Waveform
        peaks={peaks ?? []}
        progress={total ? at / total : 0}
        bars={compact ? 26 : 34}
        className="flex-1"
      />
      <span className="font-mono text-[11px] tabular-nums text-ink-3">
        {timecode(playing || at > 0 ? at : total)}
      </span>
    </div>
  );
}
