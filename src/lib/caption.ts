import "server-only";
import type { supabaseAdmin } from "@/lib/supabase/admin";

type DB = ReturnType<typeof supabaseAdmin>;

/**
 * The caption a variant actually goes out with. Its own, if it has one; otherwise
 * "same as variant 1" — the first variant's caption; otherwise the video's shared
 * caption from the Post tab. Live, not copied, so editing variant 1's caption
 * updates every variant that follows it.
 */
export async function effectiveCaption(
  db: DB,
  t: { id: string; video_id: string; caption: string | null }
): Promise<string | null> {
  if (t.caption?.trim()) return t.caption;
  const [{ data: first }, { data: v }] = await Promise.all([
    db
      .from("trial_posts")
      .select("id, caption")
      .eq("video_id", t.video_id)
      .neq("status", "archived")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    db.from("videos").select("post_caption").eq("id", t.video_id).maybeSingle(),
  ]);
  if (first && first.id !== t.id && (first.caption as string | null)?.trim()) return first.caption as string;
  const shared = (v?.post_caption as string | null)?.trim();
  return shared ? (v?.post_caption as string) : null;
}
