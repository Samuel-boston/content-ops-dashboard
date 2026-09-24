"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole, requireUser } from "@/lib/auth";
import { insertTopPosts, type TopPost } from "@/lib/top-posts";
import { parsePastedPosts, parseViews, platformOf, type TopPostInput } from "@/lib/top-posts-parse";
import { collectPosts } from "@/lib/performance";

/**
 * The Top posts list: what has worked, with the views, topic, hook and link.
 * Everyone with a seat can read it (writers use it for hooks); owners and admins
 * curate it — by hand, by pasting a list, or through the assistant tools.
 */

export async function listTopPostsAction(): Promise<TopPost[]> {
  await requireUser();
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("top_posts")
    .select("*")
    .order("views", { ascending: false, nullsFirst: false })
    .limit(500);
  return (data as TopPost[]) ?? [];
}

/** Read a pasted list without saving it, so the person can check what was understood. */
export async function previewPastedPostsAction(text: string): Promise<TopPostInput[]> {
  await requireRole("owner", "admin");
  return parsePastedPosts(text).slice(0, 200);
}

export async function addTopPostsAction(rows: TopPostInput[]) {
  const me = await requireRole("owner", "admin");
  const usable = rows.filter((r) => r.topic?.trim());
  if (!usable.length) return { error: "Nothing to add: each post needs at least a topic." };
  try {
    const res = await insertTopPosts(usable, me.id);
    revalidatePath("/library/top-posts");
    return { ok: true as const, ...res };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function updateTopPostAction(id: string, patch: Partial<TopPostInput>) {
  await requireRole("owner", "admin");
  const update: Record<string, unknown> = {};
  if (patch.topic !== undefined) {
    if (!patch.topic.trim()) return { error: "A post needs a topic." };
    update.topic = patch.topic.trim();
  }
  if (patch.hook !== undefined) update.hook = patch.hook?.trim() || null;
  if (patch.views !== undefined) update.views = parseViews(patch.views);
  if (patch.link !== undefined) {
    update.link = patch.link?.trim() || null;
    if (!patch.platform) update.platform = platformOf(patch.link ?? null);
  }
  if (patch.platform !== undefined && patch.platform) update.platform = patch.platform.trim().toLowerCase();
  if (patch.creator !== undefined) update.creator = patch.creator?.trim() || null;
  if (patch.notes !== undefined) update.notes = patch.notes?.trim() || null;
  const { error } = await supabaseAdmin().from("top_posts").update(update).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/library/top-posts");
  return { ok: true as const };
}

export async function deleteTopPostAction(id: string) {
  await requireRole("owner", "admin");
  const { error } = await supabaseAdmin().from("top_posts").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/library/top-posts");
  return { ok: true as const };
}

export interface SuggestedPost {
  videoId: string;
  topic: string;
  hook: string | null;
  views: number;
  link: string | null;
  postedAt: string;
}

/** The best posts from the client's own account that aren't on the list yet: one click adds them. */
export async function suggestOwnTopPostsAction(): Promise<SuggestedPost[]> {
  await requireRole("owner", "admin");
  const db = supabaseAdmin();
  const [posts, { data: have }] = await Promise.all([collectPosts(db), db.from("top_posts").select("link, video_id")]);
  const haveVideos = new Set((have ?? []).map((r) => r.video_id as string | null).filter(Boolean));
  const haveLinks = new Set((have ?? []).map((r) => (r.link as string | null)?.toLowerCase()).filter(Boolean));
  const seen = new Set<string>();
  return posts
    .filter((p) => !haveVideos.has(p.videoId) && !(p.link && haveLinks.has(p.link.toLowerCase())))
    .sort((a, b) => b.views - a.views)
    .filter((p) => (seen.has(p.videoId) ? false : (seen.add(p.videoId), true)))
    .slice(0, 6)
    .map((p) => ({ videoId: p.videoId, topic: p.title, hook: p.hook, views: p.views, link: p.link, postedAt: p.postedAt }));
}

export async function addSuggestedPostAction(s: SuggestedPost) {
  const me = await requireRole("owner", "admin");
  try {
    const res = await insertTopPosts(
      [{ topic: s.topic, hook: s.hook, views: s.views, link: s.link, platform: platformOf(s.link) ?? "instagram", posted_on: s.postedAt.slice(0, 10), source: "own", video_id: s.videoId }],
      me.id
    );
    revalidatePath("/library/top-posts");
    return { ok: true as const, ...res };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
