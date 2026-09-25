"use client";

import { useEffect, useState, useTransition } from "react";
import { scriptChoicesAction, suggestBrollAction, type BeatSuggestion } from "@/app/library-visuals-actions";
import { useToast } from "@/components/ui/Toast";
import { ShotCard } from "@/components/library/VisualsBrowser";

/**
 * Paste a script (or pick a video that has one) and get clips for each line. Suggestions come from
 * the same index and search as the Search view, one line at a time, without repeating a clip down the
 * script where there's a choice.
 */
export function BrollSuggester() {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [media, setMedia] = useState<"" | "video" | "image">("video");
  const [choices, setChoices] = useState<{ id: string; title: string; text: string }[]>([]);
  const [result, setResult] = useState<{ beats: BeatSuggestion[]; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void scriptChoicesAction()
      .then((c) => alive && setChoices(c))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  function run() {
    setError(null);
    start(async () => {
      const r = await suggestBrollAction(text, { media });
      if ("error" in r) {
        setResult(null);
        return setError(r.error);
      }
      setResult(r);
    });
  }

  function copyList() {
    if (!result) return;
    const out = result.beats
      .map((b) => {
        const lines = b.shots.map((s) => {
          const at = s.start_s && s.start_s > 0.5 ? ` @${Math.floor(s.start_s)}s` : "";
          return `  - ${s.filename ?? s.id}${at}${s.drive_web_link ? ` — ${s.drive_web_link}` : ""}`;
        });
        return `${b.line}\n${lines.length ? lines.join("\n") : "  (no match)"}`;
      })
      .join("\n\n");
    navigator.clipboard
      .writeText(out)
      .then(() => toast.success("Shot list copied."))
      .catch(() => toast.error("Couldn't copy."));
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-xl border border-line bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-ink-3" htmlFor="broll-script">
            Script — one line or sentence per beat
          </label>
          {choices.length ? (
            <select
              aria-label="Use a video's script"
              defaultValue=""
              onChange={(e) => {
                const c = choices.find((x) => x.id === e.target.value);
                if (c) setText(c.text);
                e.target.value = "";
              }}
              className="ml-auto max-w-[16rem] rounded-md border border-line bg-raised px-2 py-1 text-xs text-ink"
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
          onChange={(e) => setText(e.target.value)}
          rows={7}
          placeholder={"Paste what's said, one line per beat.\nEach line gets its own clips."}
          className="w-full rounded-lg border border-line-strong bg-raised px-3 py-2 text-sm outline-none placeholder:text-ink-3 focus:border-accent"
        />
        <div className="flex flex-wrap items-center gap-2">
          {(["video", "image", ""] as const).map((m) => (
            <button
              key={m || "all"}
              type="button"
              onClick={() => setMedia(m)}
              className={`rounded-full border px-2.5 py-1 text-[11px] ${media === m ? "border-accent bg-accent/10 text-ink" : "border-line text-ink-2 hover:border-accent"}`}
            >
              {m === "video" ? "Videos" : m === "image" ? "Images" : "Both"}
            </button>
          ))}
          <button
            type="button"
            onClick={run}
            disabled={pending || !text.trim()}
            className="ml-auto rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hi disabled:opacity-50"
          >
            {pending ? "Finding clips…" : "Suggest clips"}
          </button>
        </div>
        {error ? <p className="text-xs text-red-400">{error}</p> : null}
      </div>

      {result ? (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <p className="text-xs text-ink-3">
              {result.beats.length} line{result.beats.length === 1 ? "" : "s"}
              {result.truncated ? " (the first 30 — split a longer script into parts)" : ""}
            </p>
            <button type="button" onClick={copyList} className="ml-auto rounded-lg border border-line-strong px-3 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink">
              Copy shot list
            </button>
          </div>
          {result.beats.map((b, i) => (
            <section key={`${i}-${b.line}`} className="space-y-2">
              <h3 className="text-sm">
                <span className="mr-2 text-[11px] text-ink-3">{i + 1}</span>
                {b.line}
              </h3>
              {b.shots.length ? (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {b.shots.map((s) => (
                    <ShotCard key={s.id} shot={s} />
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-line bg-card px-3 py-3 text-xs text-ink-3">No match for that line. Try the Search view with fewer, plainer words.</p>
              )}
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
