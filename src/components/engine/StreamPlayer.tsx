"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface PlayerHandle {
  seek: (t: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  currentTime: () => number;
  duration: () => number;
  setRate: (r: number) => void;
  setMuted: (m: boolean) => void;
  /** The underlying element, for fullscreen and picture-in-picture. */
  element: () => HTMLVideoElement | null;
}

interface Props {
  playbackUrl: string;
  poster?: string | null;
  /** Native browser controls. Off when a custom transport is drawn instead. */
  controls?: boolean;
  className?: string;
  onTimeUpdate?: (t: number) => void;
  onLoaded?: (duration: number) => void;
  onPlayStateChange?: (playing: boolean) => void;
}

/** HLS playback via hls.js (native HLS on Safari), with an imperative handle. */
export const StreamPlayer = forwardRef<PlayerHandle, Props>(function StreamPlayer(
  { playbackUrl, poster, controls = true, className, onTimeUpdate, onLoaded, onPlayStateChange },
  ref
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    seek: (t) => {
      if (videoRef.current) videoRef.current.currentTime = t;
    },
    play: () => void videoRef.current?.play(),
    pause: () => videoRef.current?.pause(),
    toggle: () => {
      const v = videoRef.current;
      if (!v) return;
      if (v.paused) void v.play();
      else v.pause();
    },
    currentTime: () => videoRef.current?.currentTime ?? 0,
    duration: () => videoRef.current?.duration ?? 0,
    setRate: (r) => {
      if (videoRef.current) videoRef.current.playbackRate = r;
    },
    setMuted: (m) => {
      if (videoRef.current) videoRef.current.muted = m;
    },
    element: () => videoRef.current,
  }));

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setErr(null);
    let hls: { destroy: () => void } | null = null;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = playbackUrl;
    } else {
      import("hls.js")
        .then(({ default: Hls }) => {
          if (Hls.isSupported()) {
            const inst = new Hls({ enableWorker: true });
            inst.loadSource(playbackUrl);
            inst.attachMedia(video);
            inst.on(Hls.Events.ERROR, (_e, data) => {
              if (data.fatal) setErr("Playback error — the video may still be processing.");
            });
            hls = inst;
          } else {
            video.src = playbackUrl;
          }
        })
        .catch(() => setErr("Could not load the player."));
    }
    return () => hls?.destroy();
  }, [playbackUrl]);

  return (
    <>
      <video
        ref={videoRef}
        poster={poster ?? undefined}
        controls={controls}
        playsInline
        className={className ?? "w-full max-h-[60vh]"}
        onTimeUpdate={(e) => onTimeUpdate?.(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => onLoaded?.(e.currentTarget.duration)}
        onPlay={() => onPlayStateChange?.(true)}
        onPause={() => onPlayStateChange?.(false)}
      />
      {err ? (
        <p className="absolute inset-x-0 bottom-0 z-10 bg-black/70 px-3 py-1.5 text-xs text-warn">
          {err}
        </p>
      ) : null}
    </>
  );
});
