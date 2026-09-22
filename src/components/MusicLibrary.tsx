"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  IconChevronDown,
  IconLayers,
  IconPause,
  IconPlay,
  IconPlus,
  IconSearch,
  IconTrash,
} from "@/components/ui/icons";
import {
  attachTrackAction,
  createMusicUploadUrlAction,
  deleteMusicTrackAction,
  registerMusicTrackAction,
  updateMusicTrackAction,
} from "@/app/library-actions";
import { timecode } from "@/lib/format";
import { ENERGY_LEVELS, MOODS, type MusicTrack } from "@/lib/types";

const PAGE = 40;

/* ---------------------------------------------------------------- player -- */

/**
 * One shared <audio> element for the whole library. Playing a second track
 * stops the first, which is what you'd expect and also stops a long list
 * spawning dozens of media elements.
 */
function useLibraryPlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const [duration, setDuration] = useState(0);

  function toggle(track: MusicTrack) {
    if (!track.signed_url) return;
    if (!audio.current) {
      audio.current = new Audio();
      audio.current.addEventListener("timeupdate", () => setAt(audio.current?.currentTime ?? 0));
      audio.current.addEventListener("loadedmetadata", () =>
        setDuration(audio.current?.duration ?? 0)
      );
      audio.current.addEventListener("ended", () => {
        setPlayingId(null);
        setAt(0);
      });
    }
    const el = audio.current;
    if (playingId === track.id) {
      el.pause();
      setPlayingId(null);
      return;
    }
    el.src = track.signed_url;
    setAt(0);
    setDuration(track.duration_seconds ?? 0);
    void el.play();
    setPlayingId(track.id);
  }

  function seek(track: MusicTrack, fraction: number) {
    if (playingId !== track.id || !audio.current || !duration) return;
    audio.current.currentTime = fraction * duration;
  }

  return { playingId, at, duration, toggle, seek };
}

/** Deterministic bars from the track id — a real waveform needs the whole file. */
function fakeWave(seed: string, bars = 48): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 100000;
  const out: number[] = [];
  for (let i = 0; i < bars; i += 1) {
    h = (h * 1103515245 + 12345) % 2147483648;
    // Shaped so it reads like music rather than noise: a swell in the middle.
    const swell = Math.sin((i / bars) * Math.PI) * 0.5 + 0.5;
    out.push(0.25 + ((h % 100) / 100) * 0.55 * swell);
  }
  return out;
}

function Waveform({
  trackId,
  progress,
  onScrub,
}: {
  trackId: string;
  progress: number;
  onScrub?: (fraction: number) => void;
}) {
  const bars = useMemo(() => fakeWave(trackId), [trackId]);
  return (
    <span
      onClick={(e) => {
        if (!onScrub) return;
        const r = e.currentTarget.getBoundingClientRect();
        onScrub((e.clientX - r.left) / r.width);
      }}
      className={`flex h-7 flex-1 items-center gap-[2px] ${onScrub ? "cursor-pointer" : ""}`}
    >
      {bars.map((v, i) => (
        <span
          key={i}
          // flex-1 + a 1px radius: `w-full rounded-full` renders each bar as a
          // circle rather than a bar.
          className={`min-w-0 flex-1 rounded-[1px] transition-colors ${
            i / bars.length <= progress ? "bg-accent" : "bg-line-strong"
          }`}
          style={{ height: `${Math.round(v * 100)}%` }}
        />
      ))}
    </span>
  );
}

/* ----------------------------------------------------------------- row ---- */

function TrackRow({
  track,
  playing,
  progress,
  onToggle,
  onScrub,
  onDelete,
  onEdit,
  attachTo,
}: {
  track: MusicTrack;
  playing: boolean;
  progress: number;
  onToggle: () => void;
  onScrub: (f: number) => void;
  onDelete: () => void;
  onEdit: (patch: Partial<MusicTrack>) => void;
  attachTo: { id: string; title: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const [, startTransition] = useTrackedTransition();

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/track-id", track.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
      title="Drag onto a video to record that it was used there"
      className={`cursor-grab rounded-xl border px-3 py-2.5 transition active:cursor-grabbing ${
        playing ? "border-accent bg-accent-ghost" : "border-line bg-card hover:border-line-strong"
      }`}
    >
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onToggle}
          aria-label={playing ? `Pause ${track.title}` : `Play ${track.title}`}
          disabled={!track.signed_url}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white transition hover:bg-accent-hi disabled:opacity-40"
        >
          {playing ? <IconPause size={13} /> : <IconPlay size={13} />}
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{track.title}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-ink-3">
            {track.duration_seconds ? <span>{timecode(track.duration_seconds)}</span> : null}
            {track.mood ? <span>{track.mood}</span> : null}
            {track.energy ? <span>{track.energy} energy</span> : null}
            {track.bpm ? <span>{track.bpm} BPM</span> : null}
            {track.used_on?.length ? (
              <span className="text-accent-hi">
                used on {track.used_on.length} video{track.used_on.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </p>
        </div>

        <Waveform
          trackId={track.id}
          progress={playing ? progress : 0}
          onScrub={playing ? onScrub : undefined}
        />

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Track details"
          className="shrink-0 rounded p-1.5 text-ink-3 hover:bg-hover hover:text-ink"
        >
          <IconChevronDown
            size={14}
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {open ? (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-ink-3">
                Mood
              </span>
              <select
                defaultValue={track.mood ?? ""}
                onChange={(e) => onEdit({ mood: e.target.value || null })}
                className="w-full rounded-md border border-line bg-raised px-2 py-1 text-xs focus:outline-none"
              >
                <option value="">—</option>
                {MOODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-ink-3">
                Energy
              </span>
              <select
                defaultValue={track.energy ?? ""}
                onChange={(e) => onEdit({ energy: e.target.value || null })}
                className="w-full rounded-md border border-line bg-raised px-2 py-1 text-xs focus:outline-none"
              >
                <option value="">—</option>
                {ENERGY_LEVELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-ink-3">
                BPM
              </span>
              <input
                type="number"
                min={1}
                max={399}
                defaultValue={track.bpm ?? ""}
                onBlur={(e) =>
                  onEdit({ bpm: e.target.value ? Number(e.target.value) : null })
                }
                className="w-full rounded-md border border-line bg-raised px-2 py-1 text-xs focus:outline-none"
              />
            </label>
          </div>

          {/* Where it's been used */}
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-ink-3">Used on</p>
            {track.used_on?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {track.used_on.map((v) => (
                  <Link
                    key={v.id}
                    href={`/videos/${v.id}`}
                    className="rounded-md bg-raised px-2 py-1 text-[11px] text-ink-2 hover:text-accent-hi"
                  >
                    {v.title}
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-ink-3">
                Not used yet. Attach it to a video and it shows up here — that&rsquo;s what stops
                the same track landing on three posts in a week.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenu((v) => !v)}
                className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-2 hover:border-accent hover:text-ink"
              >
                <IconPlus size={11} />
                Attach to a video
              </button>
              {menu ? (
                <>
                  <span className="fixed inset-0 z-20" onClick={() => setMenu(false)} />
                  <div className="absolute left-0 z-30 mt-1 max-h-56 w-64 overflow-y-auto rounded-lg border border-line bg-raised py-1 shadow-xl">
                    {attachTo.length === 0 ? (
                      <p className="px-3 py-2 text-[11px] text-ink-3">Nothing in flight.</p>
                    ) : (
                      attachTo.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() =>
                            startTransition(async () => {
                              const res = await attachTrackAction(v.id, track.id);
                              if (res?.error) toast.error(res.error);
                              else {
                                toast.success(`Attached to “${v.title}”.`);
                                setMenu(false);
                                router.refresh();
                              }
                            })
                          }
                          className="block w-full truncate px-3 py-1.5 text-left text-xs text-ink-2 hover:bg-hover hover:text-ink"
                        >
                          {v.title}
                        </button>
                      ))
                    )}
                  </div>
                </>
              ) : null}
            </div>

            <button
              type="button"
              onClick={onDelete}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-3 hover:text-danger"
            >
              <IconTrash size={11} />
              Delete
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- main ---- */

/**
 * The drop targets. Dragging a track onto a video is the one action that feeds
 * "where it's been used", so the videos have to be on screen next to the
 * library — a drag can't cross pages.
 */
function DropTargets({ videos }: { videos: { id: string; title: string }[] }) {
  const toast = useToast();
  const router = useRouter();
  const [, startTransition] = useTrackedTransition();
  const [over, setOver] = useState<string | null>(null);

  if (!videos.length) return null;

  return (
    <aside className="rounded-xl border border-line bg-card p-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
        Drag a track onto a video
      </h2>
      <p className="mb-2.5 mt-0.5 text-[11px] leading-snug text-ink-3">
        That&rsquo;s what records which track was used where.
      </p>
      <div className="flex max-h-[28rem] flex-col gap-1 overflow-y-auto">
        {videos.map((v) => (
          <div
            key={v.id}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(v.id);
            }}
            onDragLeave={() => setOver((o) => (o === v.id ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const trackId = e.dataTransfer.getData("text/track-id");
              if (!trackId) return;
              startTransition(async () => {
                const res = await attachTrackAction(v.id, trackId);
                if (res?.error) toast.error(res.error);
                else {
                  toast.success(`Attached to “${v.title}”.`);
                  router.refresh();
                }
              });
            }}
            className={`shrink-0 truncate rounded-lg border px-2.5 py-2 text-[11px] transition ${
              over === v.id
                ? "border-accent bg-accent-ghost text-ink"
                : "border-line bg-panel text-ink-2"
            }`}
          >
            {v.title}
          </div>
        ))}
      </div>
    </aside>
  );
}

export function MusicLibrary({
  categories,
  tracks,
  attachTo,
}: {
  categories: string[];
  tracks: MusicTrack[];
  attachTo: { id: string; title: string }[];
}) {
  const toast = useToast();
  const router = useRouter();
  const [, startTransition] = useTrackedTransition();
  const player = useLibraryPlayer();

  const [category, setCategory] = useState<string>("");
  const [query, setQuery] = useState("");
  const [mood, setMood] = useState("");
  const [energy, setEnergy] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [confirmDelete, setConfirmDelete] = useState<MusicTrack | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tracks.filter((t) => {
      if (category && t.category !== category) return false;
      if (mood && t.mood !== mood) return false;
      if (energy && t.energy !== energy) return false;
      if (q && !t.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tracks, category, query, mood, energy]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of files) {
        const res = await createMusicUploadUrlAction(file.name);
        if ("error" in res && res.error) throw new Error(res.error);
        const put = await fetch(res.signedUrl!, { method: "PUT", body: file });
        if (!put.ok) throw new Error(`Upload failed for ${file.name}`);
        await registerMusicTrackAction({
          title: file.name.replace(/\.[^.]+$/, ""),
          category: category || "Uncategorised",
          storagePath: res.path!,
        });
      }
      toast.success("Uploaded.");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <IconSearch
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tracks"
            className="w-full rounded-lg border border-line bg-card py-1.5 pl-7 pr-2 text-xs placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-line bg-card px-2 py-1.5 text-xs focus:outline-none"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={mood}
          onChange={(e) => setMood(e.target.value)}
          className="rounded-lg border border-line bg-card px-2 py-1.5 text-xs focus:outline-none"
        >
          <option value="">Any mood</option>
          {MOODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={energy}
          onChange={(e) => setEnergy(e.target.value)}
          className="rounded-lg border border-line bg-card px-2 py-1.5 text-xs focus:outline-none"
        >
          <option value="">Any energy</option>
          {ENERGY_LEVELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <input
          ref={fileInput}
          type="file"
          accept="audio/*"
          multiple
          hidden
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hi disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Upload tracks"}
        </button>
      </div>

      <p className="text-xs text-ink-3">
        {shown.length} of {tracks.length} tracks
      </p>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="min-w-0 space-y-1.5">
      {shown.length === 0 ? (
        <p className="rounded-xl border border-line bg-card px-4 py-12 text-center text-sm text-ink-3">
          <IconLayers size={18} className="mx-auto mb-2 opacity-50" />
          Nothing matches.
        </p>
      ) : (
        <div className="space-y-1.5">
          {shown.slice(0, limit).map((t) => (
            <TrackRow
              key={t.id}
              track={t}
              playing={player.playingId === t.id}
              progress={player.duration ? player.at / player.duration : 0}
              onToggle={() => player.toggle(t)}
              onScrub={(f) => player.seek(t, f)}
              onDelete={() => setConfirmDelete(t)}
              onEdit={(patch) =>
                startTransition(async () => {
                  const res = await updateMusicTrackAction(t.id, patch);
                  if (res?.error) toast.error(res.error);
                  else router.refresh();
                })
              }
              attachTo={attachTo}
            />
          ))}
        </div>
      )}

      {shown.length > limit ? (
        <button
          type="button"
          onClick={() => setLimit((l) => l + PAGE)}
          className="w-full rounded-lg border border-line py-2 text-xs text-ink-2 hover:bg-hover hover:text-ink"
        >
          Show {Math.min(PAGE, shown.length - limit)} more
        </button>
      ) : null}
      </div>
      <DropTargets videos={attachTo} />
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title={`Delete “${confirmDelete?.title ?? ""}”?`}
        body="The audio file goes with it."
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const t = confirmDelete;
          setConfirmDelete(null);
          if (!t) return;
          startTransition(async () => {
            const res = await deleteMusicTrackAction(t.id);
            if (res?.error) toast.error(res.error);
            else router.refresh();
          });
        }}
      />
    </div>
  );
}
