import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchMediaInsights, listRecentMedia } from "@/lib/integrations/instagram";

const clean = (u: string) => {
  try {
    const x = new URL(u.trim());
    return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
};

/**
 * Connect a hand-posted main-feed post to its analytics.
 *
 * A post the dashboard publishes itself already carries its Instagram media id.
 * One posted by hand only has a link — so look that link up among the account's
 * recent media, and store the id and first numbers against the video. From then
 * on the ordinary metrics refresh keeps them current. Trial reels can't be
 * connected: Instagram doesn't expose them to its API. Best-effort: returns
 * whether it linked, never throws.
 */
export async function linkMainFeedAnalytics(videoId: string, permalink: string | null | undefined): Promise<boolean> {
  if (!permalink?.trim()) return false;
  try {
    const media = await listRecentMedia(50);
    const want = clean(permalink);
    const hit = media.find((m) => clean(m.permalink) === want);
    if (!hit) return false;
    const ins = await fetchMediaInsights(hit.id);
    await supabaseAdmin()
      .from("video_metrics")
      .upsert(
        {
          video_id: videoId,
          source: "instagram",
          external_media_id: hit.id,
          permalink: ins.permalink ?? permalink,
          views: ins.views,
          likes: ins.likes,
          comments: ins.comments,
          shares: ins.shares,
          saves: ins.saves,
          reach: ins.reach,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "video_id,source" }
      );
    return true;
  } catch {
    return false;
  }
}
