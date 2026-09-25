import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { TopPostInput } from "@/lib/top-posts-parse";

export interface TopPost {
  id: string;
  topic: string;
  hook: string | null;
  views: number | null;
  link: string | null;
  platform: string | null;
  creator: string | null;
  format: string | null;
  posted_on: string | null;
  notes: string | null;
  source: "own" | "inspiration";
  video_id: string | null;
  created_at: string;
}

/** Only plain web addresses are stored: a saved link ends up as an href, so nothing like javascript: gets through. */
export function cleanLink(l: string | null | undefined): string | null {
  const t = l?.trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const normLink = (l: string | null | undefined) => (l ? l.trim().replace(/\/+$/, "").toLowerCase() : null);

/**
 * Add rows to the Top posts list. Anything whose link is already there is skipped
 * rather than duplicated, so pasting the same list twice is harmless. Shared by the
 * Library screen and the assistant tools, so both behave the same.
 */
export async function insertTopPosts(
  rows: (TopPostInput & { video_id?: string | null })[],
  addedBy: string | null
): Promise<{ added: number; skipped: number }> {
  const db = supabaseAdmin();
  const { data: existing } = await db.from("top_posts").select("link, video_id");
  const haveLinks = new Set((existing ?? []).map((r) => normLink(r.link as string | null)).filter(Boolean));
  const haveVideos = new Set((existing ?? []).map((r) => r.video_id as string | null).filter(Boolean));

  const fresh: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const r of rows.slice(0, 200)) {
    const link = normLink(cleanLink(r.link));
    if ((link && haveLinks.has(link)) || (r.video_id && haveVideos.has(r.video_id))) {
      skipped++;
      continue;
    }
    if (link) haveLinks.add(link);
    if (r.video_id) haveVideos.add(r.video_id);
    fresh.push({
      topic: r.topic.slice(0, 300),
      hook: r.hook?.slice(0, 500) ?? null,
      views: r.views ?? null,
      link: cleanLink(r.link),
      platform: r.platform ?? null,
      creator: r.creator?.slice(0, 120) ?? null,
      format: r.format?.slice(0, 60) ?? null,
      posted_on: r.posted_on ?? null,
      notes: r.notes?.slice(0, 1000) ?? null,
      source: r.source === "own" ? "own" : "inspiration",
      video_id: r.video_id ?? null,
      added_by: addedBy,
    });
  }
  if (fresh.length) {
    const { error } = await db.from("top_posts").insert(fresh);
    if (error) throw new Error(error.message);
  }
  return { added: fresh.length, skipped };
}
