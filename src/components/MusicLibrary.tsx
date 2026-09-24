"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { UploadStatus, type UploadState } from "@/components/ui/UploadStatus";
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

/** Tracks dropped in without a category land here, and stay flagged until someone sorts them. */
const UNCATEGORISED = "Uncategorised";
const isUncategorised = (c: string | null | undefined) => !c || /^uncategori[sz]ed$/i.test(c.trim());
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|aif|aiff|wma)$/i;
const isAudio = (f: File) => f.type.startsWith("audio/") || AUDIO_EXT.test(f.name);
const NEW_CATEGORY = "__new__";

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
  categories,
}: {
  categories: string[];
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
  const needsCategory = isUncategorised(track.category);

  function pickCategory(value: string) {
    if (value === NEW_CATEGORY) {
      const name = window.prompt("Name the new category");
      if (name?.trim()) onEdit({ category: name.trim() });
      return;
    }
    if (value) onEdit({ category: value });
  }

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/track-id", track.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
      title="Drag onto a video to record that it was used there"
      className={`cursor-grab rounded-xl border px-3 py-2.5 transition active:cursor-grabbing ${
        playing
          ? "border-accent bg-accent-ghost"
          : needsCategory
            ? "border-danger/50 bg-danger/5"
            : "border-line bg-card hover:border-line-strong"
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
          <p className="flex items-center gap-1.5 truncate text-sm font-medium">
            {needsCategory ? (
              <span
                title="This track needs a category"
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-white"
              >
                !
              </span>
            ) : null}
            <span className="truncate">{track.title}</span>
          </p>
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

        {needsCategory ? (
          <select
            value=""
            onChange={(e) => pickCategory(e.target.value)}
            aria-label="Choose a category"
            className="shrink-0 rounded-md border border-danger/60 bg-danger/10 px-2 py-1 text-[11px] font-medium text-danger focus:outline-none"
          >
            <option value="">Choose a category…</option>
            {categories
              .filter((c) => !isUncategorised(c))
              .map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            <option value={NEW_CATEGORY}>+ New category…</option>
          </select>
        ) : null}

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
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-ink-3">Category</span>
            <select
              value={needsCategory ? "" : track.category}
              onChange={(e) => pickCategory(e.target.value)}
              className="w-full rounded-md border border-line bg-raised px-2 py-1 text-xs focus:outline-none sm:w-64"
            >
              {needsCategory ? <option value="">Uncategorised — choose one…</option> : null}
              {categories
                .filter((c) => !isUncategorised(c))
                .map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              <option value={NEW_CATEGORY}>+ New category…</option>
            </select>
          </label>
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
  const [upload, setUpload] = useState<UploadState | null>(null);
  const uploading = upload?.phase === "uploading";
  // What the next batch of dropped tracks is filed under; empty = Uncategorised, sorted later.
  const [uploadCategory, setUploadCategory] = useState("");
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uncategorised = tracks.filter((t) => isUncategorised(t.category)).length;
  const realCategories = categories.filter((c) => !isUncategorised(c));

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tracks.filter((t) => {
      if (category === UNCATEGORISED ? !isUncategorised(t.category) : category && t.category !== category) return false;
      if (mood && t.mood !== mood) return false;
      if (energy && t.energy !== energy) return false;
      if (q && !t.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tracks, category, query, mood, energy]);

  /** Upload any number of tracks at once (dropped or picked), a few in parallel. */
  async function uploadFiles(list: File[]) {
    const files = list.filter(isAudio);
    const skipped = list.length - files.length;
    if (!files.length) {
      setUpload({ phase: "error", title: "Music", detail: "Those aren't audio files — drop mp3, wav, m4a and similar." });
      return;
    }
    const target = uploadCategory.trim() || UNCATEGORISED;
    const title = `${files.length} track${files.length === 1 ? "" : "s"} → ${target}`;
    let done = 0;
    const failed: string[] = [];
    const show = () =>
      setUpload({ phase: "uploading", title, pct: Math.round((done / files.length) * 100), detail: `${done} of ${files.length} uploaded` });
    show();
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const file = files[next++];
        try {
          const res = await createMusicUploadUrlAction(file.name);
          if ("error" in res && res.error) throw new Error(res.error);
          const put = await fetch(res.signedUrl!, { method: "PUT", body: file });
          if (!put.ok) throw new Error(put.status === 413 ? "over the size limit" : `status ${put.status}`);
          const reg = await registerMusicTrackAction({
            title: file.name.replace(/\.[^.]+$/, ""),
            category: target,
            storagePath: res.path!,
          });
          if (reg && "error" in reg && reg.error) throw new Error(reg.error);
        } catch (e) {
          failed.push(`${file.name} (${(e as Error).message})`);
        }
        done += 1;
        show();
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
    const ok = files.length - failed.length;
    setUpload({
      phase: failed.length && !ok ? "error" : "done",
      title,
      detail: failed.length ? `${failed.length} failed: ${failed.slice(0, 3).join("; ")}${failed.length > 3 ? "…" : ""}` : `${ok} uploaded.`,
      doneText:
        target === UNCATEGORISED
          ? `${ok} track${ok === 1 ? "" : "s"} added as Uncategorised — choose a category for each one below.`
          : `${ok} track${ok === 1 ? "" : "s"} added to ${target}.`,
      note: skipped ? `${skipped} file${skipped === 1 ? " wasn't" : "s weren't"} audio and ${skipped === 1 ? "was" : "were"} skipped.` : undefined,
    });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* Mass upload: drop as many tracks as you like. */}
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDropping(true);
          }
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.files?.length) return;
          e.preventDefault();
          setDropping(false);
          if (!uploading) void uploadFiles(Array.from(e.dataTransfer.files));
        }}
        className={`rounded-xl border-2 border-dashed p-4 text-center transition ${
          dropping ? "border-accent bg-accent-ghost" : "border-line-strong"
        }`}
      >
        <p className="text-sm font-medium">Drag and drop your tracks here</p>
        <p className="mt-0.5 text-[11px] text-ink-3">
          As many as you like at once — mp3, wav, m4a and similar.{" "}
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
            className="text-accent-hi underline hover:no-underline disabled:opacity-50"
          >
            Or choose files
          </button>
        </p>
        <label className="mt-3 inline-flex flex-wrap items-center justify-center gap-2 text-xs text-ink-2">
          Put them in
          <select
            value={uploadCategory}
            onChange={(e) => {
              if (e.target.value === NEW_CATEGORY) {
                const name = window.prompt("Name the new category");
                if (name?.trim()) setUploadCategory(name.trim());
                return;
              }
              setUploadCategory(e.target.value);
            }}
            className="rounded-md border border-line bg-card px-2 py-1 text-xs focus:outline-none"
          >
            <option value="">Uncategorised — I&rsquo;ll sort them after</option>
            {realCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {uploadCategory && !realCategories.includes(uploadCategory) ? <option value={uploadCategory}>{uploadCategory} (new)</option> : null}
            <option value={NEW_CATEGORY}>+ New category…</option>
          </select>
        </label>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*"
          multiple
          hidden
          onChange={(e) => {
            void uploadFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      {upload ? <UploadStatus state={upload} /> : null}

      {uncategorised > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/50 bg-danger/10 px-4 py-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-danger text-sm font-bold text-white">!</span>
          <p className="min-w-0 flex-1 text-sm text-danger">
            <b>
              {uncategorised} track{uncategorised === 1 ? " needs" : "s need"} a category.
            </b>{" "}
            Until they&rsquo;re sorted they can&rsquo;t be found by category — choose one for each track below.
          </p>
          <button
            type="button"
            onClick={() => setCategory(UNCATEGORISED)}
            className="rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            Show them
          </button>
        </div>
      ) : null}

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
          {uncategorised > 0 ? <option value={UNCATEGORISED}>⚠ Uncategorised ({uncategorised})</option> : null}
          {realCategories.map((c) => (
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
              categories={categories}
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
