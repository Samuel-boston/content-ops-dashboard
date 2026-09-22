"use server";

import { supabaseServer } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import type { LibraryShot } from "@/lib/types";

// ---------------------------------------------------------------------------
// Footage index — read side of the B-Roll Librarian mirror (migration 030).
// Rows arrive via scripts/sync-broll-library.mjs; this file only searches
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

export async function searchLibraryShots(filter: VisualsFilter): Promise<LibraryShot[]> {
  await requireUser();
  const supabase = await supabaseServer();

  let q = supabase.from("library_shots").select("*");
  const text = filter.q?.trim();
  const words = text ? orQuery(text) : "";
  if (words) q = q.textSearch("tsv", words);
  if (filter.media) q = q.eq("media_kind", filter.media);
  if (filter.emotion) q = q.contains("emotions", [filter.emotion]);
  if (filter.category) q = q.ilike("category", `${filter.category}%`);
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

  return signThumbs(rows);
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
