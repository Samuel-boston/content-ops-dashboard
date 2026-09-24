import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { deleteStreamVideo } from "@/lib/integrations/stream";

/**
 * Permanently remove a video and everything that hangs off it, heavy files
 * included: the Cloudflare Stream copies, the originals in Storage, slides,
 * attachments, reference images, voice notes and covers. Database rows go with
 * the video (they cascade), so this only has to chase the files.
 *
 * Best-effort on files: a missing object never stops the delete, because a video
 * that can't be removed because of one stray file is worse than a stray file.
 * The Google Drive archive is deliberately left alone — that is the client's
 * own copy and this never reaches into it.
 */
export async function purgeVideo(videoId: string): Promise<{ title: string; files: number; streams: number }> {
  const db = supabaseAdmin();
  const { data: video } = await db
    .from("videos")
    .select("title, brief_voice_path, cover_path, thumbnail_path")
    .eq("id", videoId)
    .maybeSingle();
  if (!video) throw new Error("Not found.");

  const footage = new Set<string>();
  const carousels = new Set<string>();
  const references = new Set<string>();
  const media = new Set<string>();
  const thumbs = new Set<string>();
  const add = (set: Set<string>, p: unknown) => {
    if (typeof p === "string" && p) set.add(p);
  };
  add(footage, video.brief_voice_path);
  add(footage, video.cover_path);
  add(thumbs, video.thumbnail_path);

  const { data: cuts } = await db.from("video_cuts").select("id").eq("video_id", videoId);
  const cutIds = (cuts ?? []).map((c) => c.id as string);

  const [versions, assets, slides, refs, comments, trials, msgs, thumbRefs] = await Promise.all([
    cutIds.length
      ? db.from("cut_versions").select("stream_uid, original_path").in("cut_id", cutIds)
      : Promise.resolve({ data: [] as { stream_uid: string | null; original_path: string | null }[] }),
    db.from("video_assets").select("storage_path").eq("video_id", videoId),
    db.from("carousel_images").select("storage_path").eq("video_id", videoId),
    db.from("reference_items").select("id, storage_path").eq("video_id", videoId),
    cutIds.length
      ? db.from("cut_comments").select("voice_path").in("cut_id", cutIds)
      : Promise.resolve({ data: [] as { voice_path: string | null }[] }),
    db.from("trial_posts").select("cover_path").eq("video_id", videoId),
    db.from("video_messages").select("id").eq("video_id", videoId).limit(1),
    db.from("video_thumbnail_refs").select("storage_path").eq("video_id", videoId),
  ]);
  void msgs;

  const streamUids = new Set<string>();
  for (const v of versions.data ?? []) {
    if (v.stream_uid) streamUids.add(v.stream_uid);
    add(footage, v.original_path);
  }
  for (const a of assets.data ?? []) add(footage, a.storage_path);
  for (const s of slides.data ?? []) add(carousels, s.storage_path);
  for (const r of refs.data ?? []) add(references, r.storage_path);
  for (const c of comments.data ?? []) add(media, c.voice_path);
  for (const t of thumbRefs.data ?? []) add(thumbs, t.storage_path);
  for (const t of trials.data ?? []) add(footage, (t as { cover_path?: string | null }).cover_path);

  // Cloudflare Stream first: it is the part that keeps costing money.
  let streams = 0;
  for (const uid of streamUids) {
    try {
      await deleteStreamVideo(uid);
      streams++;
    } catch {
      /* already gone, or Stream isn't configured */
    }
  }

  let files = 0;
  const remove = async (bucket: string, paths: Set<string>) => {
    const list = [...paths];
    for (let i = 0; i < list.length; i += 100) {
      const { error } = await db.storage.from(bucket).remove(list.slice(i, i + 100));
      if (!error) files += Math.min(100, list.length - i);
    }
  };
  await remove("footage", footage);
  await remove("carousels", carousels);
  await remove("references", references);
  await remove("comment-media", media);
  await remove("thumbnails", thumbs);

  // Reference items point at the video with "on delete set null", so they'd be
  // left behind as orphans. They go with it.
  await db.from("reference_items").delete().eq("video_id", videoId);

  const { error } = await db.from("videos").delete().eq("id", videoId);
  if (error) throw new Error(error.message);
  return { title: video.title as string, files, streams };
}
