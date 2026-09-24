import "server-only";
import { getWorkspaceSettings } from "@/lib/workspace";
import { NotConfiguredError } from "@/lib/integrations/stream";

const GRAPH = "https://graph.facebook.com/v21.0";

async function igConfig() {
  const s = await getWorkspaceSettings();
  if (!s.ig_user_id || !s.ig_access_token) throw new NotConfiguredError("Instagram Graph API");
  return { userId: s.ig_user_id, token: s.ig_access_token };
}

export interface IgInsights {
  externalMediaId: string;
  permalink: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  reach: number | null;
}

/**
 * Pull metrics for one posted media item. `externalMediaId` is the IG media id
 * (stored on video_metrics once the video is published / linked).
 */
export async function fetchMediaInsights(externalMediaId: string): Promise<IgInsights> {
  const ig = await igConfig();
  const fields = "id,permalink,like_count,comments_count";
  const base = await fetch(
    `${GRAPH}/${externalMediaId}?fields=${fields}&access_token=${ig.token}`
  ).then((r) => r.json());

  const metric = "reach,saved,shares,plays,total_interactions";
  const insights = await fetch(
    `${GRAPH}/${externalMediaId}/insights?metric=${metric}&access_token=${ig.token}`
  ).then((r) => r.json());

  const val = (name: string): number | null => {
    const row = insights?.data?.find((d: { name: string }) => d.name === name);
    const v = row?.values?.[0]?.value;
    return typeof v === "number" ? v : null;
  };

  return {
    externalMediaId,
    permalink: base?.permalink ?? null,
    views: val("plays"),
    likes: typeof base?.like_count === "number" ? base.like_count : null,
    comments: typeof base?.comments_count === "number" ? base.comments_count : null,
    shares: val("shares"),
    saves: val("saved"),
    reach: val("reach"),
  };
}

/** List recent media so a posted video can be matched to its IG media id. */
export async function listRecentMedia(limit = 25) {
  const ig = await igConfig();
  const res = await fetch(
    `${GRAPH}/${ig.userId}/media?fields=id,caption,permalink,media_type,timestamp&limit=${limit}&access_token=${ig.token}`
  ).then((r) => r.json());
  return (res?.data ?? []) as Array<{
    id: string;
    caption?: string;
    permalink: string;
    media_type: string;
    timestamp: string;
  }>;
}

// ---- Publishing (Content Publishing API) --------------------------------------

/** Step 1: create a media container for a video (Reel). Returns creation id. */
export async function createReelContainer(
  videoUrl: string,
  caption?: string,
  opts?: { thumbOffsetMs?: number; shareToFeed?: boolean }
): Promise<string> {
  const ig = await igConfig();
  const res = await fetch(`${GRAPH}/${ig.userId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "REELS",
      video_url: videoUrl,
      caption: caption ?? "",
      // Picks a frame from the video itself as the cover — no separate
      // image upload. Zero is a valid offset, so only omit when unset.
      ...(opts?.thumbOffsetMs != null ? { thumb_offset: opts.thumbOffsetMs } : {}),
      share_to_feed: opts?.shareToFeed ?? true,
      access_token: ig.token,
    }),
  }).then((r) => r.json());
  if (!res?.id) throw new Error(`IG container failed: ${JSON.stringify(res)}`);
  return res.id;
}

export async function containerReady(creationId: string): Promise<"ready" | "in_progress" | "error"> {
  const ig = await igConfig();
  const res = await fetch(
    `${GRAPH}/${creationId}?fields=status_code&access_token=${ig.token}`
  ).then((r) => r.json());
  if (res?.status_code === "FINISHED") return "ready";
  if (res?.status_code === "ERROR" || res?.status_code === "EXPIRED") return "error";
  return "in_progress";
}

/** Step 2: publish a ready container. Returns the IG media id. */
export async function publishContainer(creationId: string): Promise<string> {
  const ig = await igConfig();
  const res = await fetch(`${GRAPH}/${ig.userId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: creationId, access_token: ig.token }),
  }).then((r) => r.json());
  if (!res?.id) throw new Error(`IG publish failed: ${JSON.stringify(res)}`);
  return res.id;
}

/**
 * Create a carousel container from public image URLs (2–10, JPEG). Each image
 * becomes a "carousel item" container first, then one CAROUSEL container ties
 * them together in order. Returns the creation id to publish.
 */
export async function createCarouselContainer(imageUrls: string[], caption?: string): Promise<string> {
  if (imageUrls.length < 2) throw new Error("An Instagram carousel needs at least 2 images.");
  if (imageUrls.length > 10) throw new Error("An Instagram carousel can have at most 10 images.");
  const ig = await igConfig();

  const children: string[] = [];
  for (const url of imageUrls) {
    const res = await fetch(`${GRAPH}/${ig.userId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: url, is_carousel_item: true, access_token: ig.token }),
    }).then((r) => r.json());
    if (!res?.id) throw new Error(`IG carousel item failed: ${JSON.stringify(res)}`);
    children.push(res.id);
  }

  // Images are normally instant, but the parent can't be built until every
  // child reports FINISHED.
  for (const id of children) {
    for (let i = 0; i < 15; i++) {
      const state = await containerReady(id);
      if (state === "ready") break;
      if (state === "error") throw new Error("Instagram rejected one of the carousel images.");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const res = await fetch(`${GRAPH}/${ig.userId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "CAROUSEL",
      children: children.join(","),
      caption: caption ?? "",
      access_token: ig.token,
    }),
  }).then((r) => r.json());
  if (!res?.id) throw new Error(`IG carousel container failed: ${JSON.stringify(res)}`);
  return res.id;
}
