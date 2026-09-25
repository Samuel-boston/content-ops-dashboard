"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { matchBeatsAction, scriptChoicesAction, type BeatResult, type RankedShot } from "@/app/library-visuals-actions";
import { useToast } from "@/components/ui/Toast";
import { ShotCard } from "@/components/library/VisualsBrowser";
import { beatDuration, beatsFromText, clock, type Beat } from "@/lib/broll-transcript";
import { SUGGESTIONS_PER_BEAT } from "@/lib/broll-match";
import { buildTimeline, csv, edl, fcp7Xml, type ExportBeat, type ExportShot } from "@/lib/broll-export";

const CHUNK = 5;
const MAX_BEATS = 60;
const FPS = [23.976, 24, 25, 29.97, 30, 50, 60];
const SIZES: { label: string; w: number; h: number }[] = [
  { label: "Vertical 1080 × 1920", w: 1080, h: 1920 },
  { label: "Landscape 1920 × 1080", w: 1920, h: 1080 },
  { label: "Square 1080 × 1080", w: 1080, h: 1080 },
];
const MOUNT_KEY = "broll.driveMount";

const toExportShot = (s: RankedShot["shot"]): ExportShot => ({
  id: s.id,
  sourceId: s.source_id,
  filename: s.filename,
  drivePath: s.drive_path,
  driveLink: s.drive_web_link,
  startS: s.start_s ?? 0,
  durationS: s.duration_s,
  media: s.media_kind,
  shotType: s.shot_type,
  setting: s.setting,
});

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The B-roll suggester. Paste a script or a transcript (.srt and .vtt keep their real timings), and
 * each beat of it gets clips from the library, ranked by an AI editor that can say "no good match".
 * Swap any pick, see the footage still to be shot, and export the result to Premiere or Resolve.
 */
export function BrollSuggester() {
  const toast = useToast();
  const [text, setText] = useState("");
  const [filename, setFilename] = useState<string | undefined>();
  const [wpm, setWpm] = useState(150);
  const [media, setMedia] = useState<"" | "video" | "image">("video");
  const [choices, setChoices] = useState<{ id: string; title: string; text: string }[]>([]);
  const [beats, setBeats] = useState<Beat[]>([]);
  const [results, setResults] = useState<Record<number, BeatResult>>({});
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [more, setMore] = useState<Record<number, boolean>>({});
  const run = useRef(0);

  const [exportName, setExportName] = useState("B-Roll Suggestions");
  const [fps, setFps] = useState(25);
  const [size, setSize] = useState(0);
  const [mount, setMount] = useState(() => {
    try {
      return typeof window === "undefined" ? "" : (localStorage.getItem(MOUNT_KEY) ?? "");
    } catch {
      return "";
    }
  });
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    void scriptChoicesAction().then((c) => alive && setChoices(c)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const running = progress !== null && progress.done < progress.total;

  async function start() {
    setError(null);
    setNote(null);
    setWarnings([]);
    const found = beatsFromText(text, filename, wpm);
    if (!found.length) return setError("Paste a script or transcript first, a few lines of what's said.");
    if (found.length > MAX_BEATS) return setError(`That's ${found.length} beats. Split it into parts of ${MAX_BEATS} or fewer.`);
    const id = ++run.current;
    setBeats(found);
    setResults({});
    setChosen({});
    setMore({});
    setProgress({ done: 0, total: found.length });
    let used: Record<string, number> = {};
    for (let i = 0; i < found.length; i += CHUNK) {
      if (run.current !== id) return;
      const r = await matchBeatsAction(found.slice(i, i + CHUNK), { media, used }).catch(() => ({ error: "That didn't go through. Try again." }));
      if (run.current !== id) return;
      if ("error" in r) {
        setError(r.error);
        setProgress(null);
        return;
      }
      used = r.used;
      if (r.note) setNote(r.note);
      setResults((prev) => ({ ...prev, ...Object.fromEntries(r.results.map((x) => [x.index, x])) }));
      setProgress({ done: Math.min(found.length, i + CHUNK), total: found.length });
    }
  }

  function stop() {
    run.current++;
    setProgress(null);
  }

  /** What is shown for a beat: the chosen clip first, the model's next picks after it. */
  function view(b: Beat) {
    const r = results[b.index];
    if (!r) return null;
    const pick = chosen[b.index];
    const ranked = pick ? [...r.ranked.filter((x) => x.shot.id === pick), ...r.ranked.filter((x) => x.shot.id !== pick)] : r.ranked;
    const gap = r.noGoodMatch && !pick;
    return { ranked, gap, suggestions: gap ? [] : ranked.slice(0, SUGGESTIONS_PER_BEAT), rest: ranked.slice(gap ? 0 : SUGGESTIONS_PER_BEAT), missing: r.missing };
  }

  const exportBeats: ExportBeat[] = useMemo(
    () =>
      beats.flatMap((b) => {
        const v = view(b);
        if (!v) return [];
        return [
          {
            beat: b,
            missing: v.missing,
            suggestions: v.suggestions.map((s) => ({ shot: toExportShot(s.shot), reason: s.reason, confidence: s.confidence, reused: s.reused })),
          },
        ];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [beats, results, chosen]
  );

  const gaps = exportBeats.filter((m) => !m.suggestions.length);
  const finished = beats.length > 0 && Object.keys(results).length === beats.length;

  function doExport(kind: "xml" | "edl" | "csv") {
    const config = { name: exportName.trim() || "B-Roll Suggestions", fps, width: SIZES[size].w, height: SIZES[size].h, mountPath: mount };
    const tl = buildTimeline(exportBeats, config);
    setWarnings(tl.warnings);
    const base = config.name.replace(/[^\w.-]+/g, "_");
    if (kind === "xml") download(`${base}.xml`, fcp7Xml(tl), "application/xml");
    else if (kind === "edl") download(`${base}.edl`, edl(tl), "text/plain");
    else download(`${base}.csv`, csv(exportBeats, tl), "text/csv");
  }

  const chip = (on: boolean) => `rounded-full border px-2.5 py-1 text-[11px] ${on ? "border-accent bg-accent/10 text-ink" : "border-line text-ink-2 hover:border-accent"}`;
  const field = "rounded-md border border-line bg-raised px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none";

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-xl border border-line bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-ink-3" htmlFor="broll-script">
            Script or transcript
          </label>
          <label className="ml-auto cursor-pointer rounded-md border border-line px-2 py-1 text-xs text-ink-2 hover:border-accent">
            Upload .srt / .vtt / .txt
            <input
              type="file"
              accept=".srt,.vtt,.txt,.md,text/plain"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                if (f.size > 500_000) return toast.error("That file is too big for a script.");
                setText(await f.text());
                setFilename(f.name);
              }}
            />
          </label>
          {choices.length ? (
            <select
              aria-label="Use a video's script"
              defaultValue=""
              onChange={(e) => {
                const c = choices.find((x) => x.id === e.target.value);
                if (c) {
                  setText(c.text);
                  setFilename(undefined);
                }
                e.target.value = "";
              }}
              className={`${field} max-w-[14rem]`}
            >
              <option value="">Use a video&rsquo;s script…</option>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <textarea
          id="broll-script"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setFilename(undefined);
          }}
          rows={7}
          placeholder={"Paste what's said, or drop in an .srt or .vtt for exact timings.\nEvery few seconds of narration becomes a beat with its own clips."}
          className="w-full rounded-lg border border-line-strong bg-raised px-3 py-2 text-sm outline-none placeholder:text-ink-3 focus:border-accent"
        />
        <div className="flex flex-wrap items-center gap-2">
          {(["video", "image", ""] as const).map((m) => (
            <button key={m || "both"} type="button" onClick={() => setMedia(m)} className={chip(media === m)}>
              {m === "video" ? "Videos" : m === "image" ? "Images" : "Both"}
            </button>
          ))}
          <label className="flex items-center gap-1.5 text-[11px] text-ink-3" title="Only used for plain text, which has no timecodes">
            Reading speed
            <input type="number" min={80} max={300} value={wpm} onChange={(e) => setWpm(Math.min(300, Math.max(80, Number(e.target.value) || 150)))} className={`${field} w-16`} />
            wpm
          </label>
          {running ? (
            <button type="button" onClick={stop} className="ml-auto rounded-lg border border-line-strong px-4 py-2 text-sm text-ink-2 hover:border-accent">
              Stop
            </button>
          ) : (
            <button type="button" onClick={start} disabled={!text.trim()} className="ml-auto rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hi disabled:opacity-50">
              Suggest clips
            </button>
          )}
        </div>
        {error ? <p className="text-xs text-red-400">{error}</p> : null}
        {progress && running ? (
          <div>
            <div className="h-1.5 overflow-hidden rounded-full bg-raised">
              <div className="h-full bg-accent transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
            <p className="mt-1 text-[11px] text-ink-3">
              Beat {Math.min(progress.done + 1, progress.total)} of {progress.total}…
            </p>
          </div>
        ) : null}
        {note ? <p className="text-xs text-amber-400">{note}</p> : null}
      </div>

      {beats.length > 0 ? (
        <div className="space-y-5">
          <p className="text-xs text-ink-3">
            {beats.length} beat{beats.length === 1 ? "" : "s"}, {clock(beats[beats.length - 1].endS)} long
            {beats[0].estimated ? ". Timings are estimated from the reading speed; an .srt or .vtt gives exact ones" : ""}.
          </p>

          {beats.map((b) => {
            const v = view(b);
            return (
              <section key={b.index} className="space-y-2">
                <h3 className="text-sm">
                  <span className="mr-2 font-mono text-[11px] text-ink-3">
                    {b.index + 1} · {clock(b.startS)}–{clock(b.endS)} ({beatDuration(b).toFixed(0)}s)
                  </span>
                  {b.text}
                </h3>
                {!v ? (
                  <p className="text-xs text-ink-3">{running ? "Waiting…" : ""}</p>
                ) : v.gap ? (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 text-xs">
                    <p className="font-medium text-amber-400">No good match</p>
                    <p className="mt-0.5 text-ink-2">{v.missing}</p>
                    {v.rest.length ? (
                      <button type="button" onClick={() => setMore((m) => ({ ...m, [b.index]: !m[b.index] }))} className="mt-1.5 text-accent hover:underline">
                        {more[b.index] ? "Hide" : "Show"} the closest clips anyway
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    {v.suggestions.map((s, i) => (
                      <Pick key={s.shot.id} s={s} i={i} beat={b} onUse={() => setChosen((c) => ({ ...c, [b.index]: s.shot.id }))} />
                    ))}
                  </div>
                )}
                {v && !v.gap && v.rest.length ? (
                  <button type="button" onClick={() => setMore((m) => ({ ...m, [b.index]: !m[b.index] }))} className="text-[11px] text-accent hover:underline">
                    {more[b.index] ? "Fewer options" : `${v.rest.length} more options`}
                  </button>
                ) : null}
                {v && more[b.index] && v.rest.length ? (
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {v.rest.map((s) => (
                      <Pick key={s.shot.id} s={s} i={-1} beat={b} onUse={() => setChosen((c) => ({ ...c, [b.index]: s.shot.id }))} />
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}

          {finished && gaps.length ? (
            <section className="space-y-1.5 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
              <h3 className="text-sm font-semibold">Footage to shoot</h3>
              <ul className="space-y-1 text-xs text-ink-2">
                {gaps.map((g) => (
                  <li key={g.beat.index}>
                    <span className="font-mono text-ink-3">{g.beat.index + 1} · {clock(g.beat.startS)}</span> {g.missing ?? "Nothing suited this line."}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {finished ? (
            <section className="space-y-3 rounded-xl border border-line bg-card p-3">
              <h3 className="text-sm font-semibold">Export the timeline</h3>
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
                <input value={exportName} onChange={(e) => setExportName(e.target.value)} aria-label="Sequence name" className={`${field} w-44`} />
                <select value={fps} onChange={(e) => setFps(Number(e.target.value))} aria-label="Frame rate" className={field}>
                  {FPS.map((f) => (
                    <option key={f} value={f}>
                      {f} fps
                    </option>
                  ))}
                </select>
                <select value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Frame size" className={field}>
                  {SIZES.map((z, i) => (
                    <option key={z.label} value={i}>
                      {z.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="block text-xs text-ink-2">
                Where Google Drive for desktop shows the B-roll library on your computer
                <input
                  suppressHydrationWarning
                  value={mount}
                  onChange={(e) => {
                    setMount(e.target.value);
                    try {
                      localStorage.setItem(MOUNT_KEY, e.target.value);
                    } catch {
                      /* private mode */
                    }
                  }}
                  placeholder="/Users/you/Library/CloudStorage/GoogleDrive-you@gmail.com/My Drive/B-Roll"
                  className={`${field} mt-1 w-full`}
                />
                <span className="text-[11px] text-ink-3">An editing app can&rsquo;t open a Drive link, so this is how it finds the files. Leave it empty and clips import offline to relink by hand.</span>
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => doExport("xml")} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hi">
                  Premiere / Resolve (.xml)
                </button>
                <button type="button" onClick={() => doExport("edl")} className="rounded-lg border border-line-strong px-3 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink">
                  EDL
                </button>
                <button type="button" onClick={() => doExport("csv")} className="rounded-lg border border-line-strong px-3 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink">
                  CSV list
                </button>
              </div>
              {warnings.length ? (
                <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-amber-400">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Pick({ s, i, beat, onUse }: { s: RankedShot; i: number; beat: Beat; onUse: () => void }) {
  const dur = beatDuration(beat);
  const short = s.shot.media_kind === "video" && s.shot.duration_s !== null && s.shot.duration_s < dur - 0.5;
  return (
    <div className="space-y-1">
      <ShotCard
        shot={s.shot}
        action={
          i === 0 ? (
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">Best</span>
          ) : (
            <button type="button" onClick={onUse} className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-2 hover:border-accent hover:text-ink">
              Use this
            </button>
          )
        }
      />
      {s.reason ? <p className="text-[11px] leading-snug text-ink-2">{s.reason}</p> : null}
      <p className="text-[10px] text-ink-3">
        {s.reused ? "Already used earlier. " : ""}
        {short ? `Shorter than the beat (${s.shot.duration_s!.toFixed(0)}s of ${dur.toFixed(0)}s).` : ""}
      </p>
    </div>
  );
}
