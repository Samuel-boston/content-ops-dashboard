"use server";

import { supabaseServer } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import type { LibraryShot } from "@/lib/types";
import { NO_CATEGORY, folderName, splitBeats } from "@/lib/broll";

// ---------------------------------------------------------------------------
// Footage index — read side of the B-Roll Librarian mirror (migration 030).
// Rows arrive from the B-Roll Librarian (`broll connect-dashboard`); this file only searches
// them. RLS: any seat can read (the whole team picks visuals); there is no
// authenticated write path at all.
// ---------------------------------------------------------------------------

export interface VisualsFilter {
  q?: string;
  media?: "video" | "image" | "";
  emotion?: string;
  category?: string;
  topPicks?: boolean;
  featured?: boolean;
  limit?: number;
}

async function signThumbs(shots: LibraryShot[]): Promise<LibraryShot[]> {
  const supabase = await supabaseServer();
  return Promise.all(
    shots.map(async (s) => {
      if (!s.thumb_path) return s;
      const { data } = await supabase.storage.from("library-thumbs").createSignedUrl(s.thumb_path, 3600);
      return { ...s, thumb_url: data?.signedUrl };
    })
  );
}

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by",
  "from", "up", "about", "into", "through", "during", "how", "when", "where", "why", "what",
  "who", "this", "that", "these", "those", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might",
  "must", "can", "i", "you", "he", "she", "it", "we", "they", "my", "your", "his", "her", "its",
  "our", "their", "me", "him", "us", "them", "no", "not", "so", "than", "then", "if", "as",
]);

/**
 * A slide caption is a sentence ("Meditation on the beach changed how I
 * start my mornings"), not a keyword list. `websearch_to_tsquery` ANDs every
 * significant word by default — so a shot's search_text has to contain the
 * ENTIRE sentence's vocabulary to match, which basically never happens. This
 * builds an OR query from the caption's own words instead, so a shot that
 * hits on "meditation" and "beach" still surfaces even though it obviously
 * doesn't also mention "changed" or "mornings".
 */
function orQuery(text: string): string {
  const words = [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    ),
  ];
  return words.map((w) => `${w}:*`).join(" | ");
}

async function queryLibraryShots(filter: VisualsFilter): Promise<LibraryShot[]> {
  const supabase = await supabaseServer();

  let q = supabase.from("library_shots").select("*");
  const text = filter.q?.trim();
  const words = text ? orQuery(text) : "";
  if (words) q = q.textSearch("tsv", words);
  if (filter.media) q = q.eq("media_kind", filter.media);
  if (filter.emotion) q = q.contains("emotions", [filter.emotion]);
  if (filter.category === NO_CATEGORY) q = q.is("category", null);
  else if (filter.category) q = q.ilike("category", `${filter.category.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  if (filter.topPicks) q = q.eq("top_pick", true);
  if (filter.featured) q = q.eq("featured_person", true);

  const limit = Math.min(filter.limit ?? 48, 96);
  // Over-fetch when text-searching so relevance ranking (below) has more than
  // the DB's top_pick/synced_at ordering to work with.
  const { data } = await q
    .order("top_pick", { ascending: false })
    .order("synced_at", { ascending: false })
    .limit(words ? Math.min(limit * 4, 96) : limit);

  let rows = (data as LibraryShot[]) ?? [];
  if (words) {
    const terms = words.split(" | ").map((w) => w.replace(/:\*$/, ""));
    rows = rows
      .map((r) => ({
        r,
        score: terms.reduce(
          (n, t) => n + ((r.search_text ?? "").toLowerCase().includes(t) ? 1 : 0),
          0
        ),
      }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.r)
      .slice(0, limit);
  }

  return rows;
}

export async function searchLibraryShots(filter: VisualsFilter): Promise<LibraryShot[]> {
  await requireUser();
  return signThumbs(await queryLibraryShots(filter));
}

/**
 * Specific shots by id, in the order asked for, with fresh thumbnail links —
 * for the slide designer, which needs to show the photos already pinned to a
 * slide, not search for them again.
 */
export async function getLibraryShotsByIds(ids: string[]): Promise<LibraryShot[]> {
  await requireUser();
  if (!ids.length) return [];
  const supabase = await supabaseServer();
  const { data } = await supabase.from("library_shots").select("*").in("id", ids.slice(0, 8));
  const byId = new Map(((data as LibraryShot[]) ?? []).map((r) => [r.id, r]));
  const ordered = ids.map((id) => byId.get(id)).filter((r): r is LibraryShot => Boolean(r));
  return signThumbs(ordered);
}

/** Facet values for the filter chips, computed from what's actually indexed. */
export async function libraryFacets(): Promise<{ emotions: string[]; categories: string[]; total: number }> {
  await requireUser();
  const supabase = await supabaseServer();
  const { data, count } = await supabase
    .from("library_shots")
    .select("emotions, category", { count: "exact" })
    .limit(1000);
  const emotions = new Map<string, number>();
  const categories = new Set<string>();
  for (const row of (data ?? []) as { emotions: string[]; category: string | null }[]) {
    for (const e of row.emotions ?? []) emotions.set(e, (emotions.get(e) ?? 0) + 1);
    if (row.category) categories.add(row.category.split("/")[0]);
  }
  return {
    emotions: [...emotions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([e]) => e),
    categories: [...categories].sort(),
    total: count ?? 0,
  };
}

/**
 * Visual suggestions for one carousel slide: search the index with the
 * slide's own words. Same engine as the Footage page — no separate ranking to
 * reason about — and a handful of results, because this feeds a picker, not
 * a browse. Images only: a carousel slide is a still, and the librarian's
 * "thumbnail" for a video shot is just one extracted frame — not a composed
 * photo — so it isn't offered here even though it exists in the index.
 */
export async function suggestSlideVisualsAction(text: string): Promise<LibraryShot[]> {
  await requireUser();
  const cleaned = text.trim();
  if (!cleaned) return [];
  const results = await searchLibraryShots({ q: cleaned, media: "image", limit: 8 });
  if (results.length > 0) return results;
  // Websearch found nothing (captions rarely match slide copy word-for-word):
  // fall back to the strongest material so the picker is never a dead end.
  return searchLibraryShots({ topPicks: true, media: "image", limit: 8 });
}

// ---------------------------------------------------------------------------
// The B-roll section: browse by the library's own folders, and suggest clips
// for a script.
// ---------------------------------------------------------------------------

export interface BrollTree {
  total: number;
  sections: {
    /** The section as stored, e.g. "04_Daily Rituals" — what the filter matches on. */
    key: string;
    name: string;
    count: number;
    subs: { key: string; name: string; count: number }[];
  }[];
  uncategorised: number;
}

/** The library's folder structure with a count on every folder, built from the shots themselves. */
export async function libraryTree(): Promise<BrollTree> {
  await requireUser();
  const supabase = await supabaseServer();
  const counts = new Map<string, number>();
  let uncategorised = 0;
  let total = 0;
  for (let from = 0; from < 20000; from += 1000) {
    const { data } = await supabase.from("library_shots").select("category").range(from, from + 999);
    const rows = (data ?? []) as { category: string | null }[];
    for (const r of rows) {
      total++;
      if (!r.category) uncategorised++;
      else counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    }
    if (rows.length < 1000) break;
  }
  const bySection = new Map<string, BrollTree["sections"][number]>();
  for (const [cat, n] of counts) {
    const [section, ...rest] = cat.split("/");
    const sec = bySection.get(section) ?? { key: section, name: folderName(section), count: 0, subs: [] };
    sec.count += n;
    if (rest.length) sec.subs.push({ key: cat, name: rest.join(" / "), count: n });
    bySection.set(section, sec);
  }
  const sections = [...bySection.values()].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  for (const s of sections) s.subs.sort((a, b) => a.name.localeCompare(b.name));
  return { total, sections, uncategorised };
}

export interface BeatSuggestion {
  line: string;
  shots: LibraryShot[];
}

const MAX_BEATS = 30;
const PER_BEAT = 4;

/**
 * Suggest clips for a script. Each line is searched on its own with the same engine as the Search
 * view. A clip is offered for at most one line where there's a choice, so the suggestions don't
 * repeat one shot all the way down the script; a line with nothing new falls back to its best match.
 */
export async function suggestBrollAction(
  text: string,
  opts: { media?: "video" | "image" | "" } = {}
): Promise<{ beats: BeatSuggestion[]; truncated: boolean } | { error: string }> {
  await requireUser();
  const all = splitBeats(text.slice(0, 20000));
  if (!all.length) return { error: "Paste a script first — a few lines of what's said." };
  const lines = all.slice(0, MAX_BEATS);

  const found: LibraryShot[][] = [];
  for (let i = 0; i < lines.length; i += 6) {
    const batch = await Promise.all(lines.slice(i, i + 6).map((line) => queryLibraryShots({ q: line, media: opts.media ?? "", limit: 16 })));
    found.push(...batch);
  }

  const used = new Set<string>();
  const picked = found.map((rows) => {
    const fresh = rows.filter((r) => !used.has(r.id));
    const choice = (fresh.length >= PER_BEAT ? fresh : [...fresh, ...rows.filter((r) => used.has(r.id))]).slice(0, PER_BEAT);
    for (const r of choice) used.add(r.id);
    return choice;
  });

  const signed = await signThumbs(picked.flat());
  const byId = new Map(signed.map((s) => [s.id, s]));
  return {
    beats: lines.map((line, i) => ({ line, shots: picked[i].map((s) => byId.get(s.id) ?? s) })),
    truncated: all.length > MAX_BEATS,
  };
}

/** Videos with a script written, for "use this video's script". */
export async function scriptChoicesAction(): Promise<{ id: string; title: string; text: string }[]> {
  await requireUser();
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("videos")
    .select("id, title, script_hooks, script_body, script_cta")
    .not("script_body", "is", null)
    .order("updated_at", { ascending: false })
    .limit(40);
  return ((data ?? []) as { id: string; title: string; script_hooks: string[] | null; script_body: string | null; script_cta: string | null }[])
    .map((v) => ({
      id: v.id,
      title: v.title,
      text: [v.script_hooks?.find((h) => h?.trim()), v.script_body, v.script_cta].filter((x) => x && x.trim()).join("\n"),
    }))
    .filter((v) => v.text.trim());
}
