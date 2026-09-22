"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireRole, requireUser } from "@/lib/auth";
import { generateSlideImage } from "@/lib/integrations/openai-images";
import { NotConfiguredError } from "@/lib/integrations/stream";
import type { CarouselImage } from "@/lib/types";

// ---------------------------------------------------------------------------
// Carousel images — the deliverable for a "Carousel with text" video. These
// skip Cloudflare Stream entirely (they're images, not video) and land in the
// `carousels` Supabase Storage bucket, same shape as footage/references.
// ---------------------------------------------------------------------------

export async function listCarouselImages(videoId: string): Promise<CarouselImage[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("carousel_images")
    .select("*")
    .eq("video_id", videoId)
    .order("position", { ascending: true });
  const rows = (data as CarouselImage[]) ?? [];
  return Promise.all(
    rows.map(async (img) => {
      if (!img.storage_path) return img;
      const { data: signed } = await supabase.storage
        .from("carousels")
        .createSignedUrl(img.storage_path, 3600);
      return { ...img, signed_url: signed?.signedUrl };
    })
  );
}

export async function createCarouselUploadUrlAction(videoId: string, filename: string) {
  await requireUser();
  const supabase = await supabaseServer();
  const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${videoId}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await supabase.storage.from("carousels").createSignedUploadUrl(path);
  if (error) return { error: error.message };
  return { ok: true as const, path, signedUrl: data.signedUrl };
}

/**
 * A slide written at the scripting stage (caption, no image yet) should get
 * its image here rather than a brand new slide appearing after it — so this
 * fills the earliest empty slot (by position) if one exists, and only
 * appends a new row once every existing slide already has an image.
 */
export async function registerCarouselImageAction(input: {
  videoId: string;
  storagePath: string;
  sizeBytes?: number | null;
}) {
  const me = await requireUser();
  const supabase = await supabaseServer();

  const { data: openSlot } = await supabase
    .from("carousel_images")
    .select("id")
    .eq("video_id", input.videoId)
    .is("storage_path", null)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  const { error } = openSlot
    ? await supabase
        .from("carousel_images")
        .update({ storage_path: input.storagePath, size_bytes: input.sizeBytes ?? null, uploaded_by: me.id })
        .eq("id", openSlot.id)
    : await (async () => {
        const { count } = await supabase
          .from("carousel_images")
          .select("id", { count: "exact", head: true })
          .eq("video_id", input.videoId);
        return supabase.from("carousel_images").insert({
          video_id: input.videoId,
          position: count ?? 0,
          storage_path: input.storagePath,
          size_bytes: input.sizeBytes ?? null,
          uploaded_by: me.id,
        });
      })();
  if (error) return { error: error.message };
  revalidatePath(`/videos/${input.videoId}`);
  revalidatePath(`/videos/${input.videoId}/idea`);
  revalidatePath(`/videos/${input.videoId}/script`);
  revalidatePath(`/videos/${input.videoId}/editor-brief`);
  revalidatePath(`/videos/${input.videoId}/review`);
  return { ok: true as const };
}

/**
 * A slide written before it has an image — the scripting stage's per-slide
 * text, filled in on the same table an uploaded image will later join
 * (matched by position). storage_path stays null until Ready to Film/editing
 * uploads the actual slide.
 */
export async function createCarouselSlideAction(videoId: string) {
  const me = await requireUser();
  const supabase = await supabaseServer();
  const { count } = await supabase
    .from("carousel_images")
    .select("id", { count: "exact", head: true })
    .eq("video_id", videoId);
  const { error } = await supabase.from("carousel_images").insert({
    video_id: videoId,
    position: count ?? 0,
    caption: "",
    uploaded_by: me.id,
  });
  if (error) return { error: error.message };
  revalidatePath(`/videos/${videoId}/idea`);
  revalidatePath(`/videos/${videoId}/script`);
  revalidatePath(`/videos/${videoId}/editor-brief`);
  return { ok: true as const };
}

export async function updateCarouselCaptionAction(id: string, videoId: string, caption: string) {
  await requireUser();
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("carousel_images")
    .update({ caption: caption.trim() || null })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/videos/${videoId}`);
  revalidatePath(`/videos/${videoId}/idea`);
  revalidatePath(`/videos/${videoId}/script`);
  revalidatePath(`/videos/${videoId}/editor-brief`);
  revalidatePath(`/videos/${videoId}/review`);
  return { ok: true as const };
}

/** Swaps this slide's position with its neighbor — good enough for a handful of slides without pulling in a drag-and-drop library. */
export async function moveCarouselImageAction(id: string, videoId: string, direction: "left" | "right") {
  await requireUser();
  const supabase = await supabaseServer();
  const { data: rows } = await supabase
    .from("carousel_images")
    .select("id, position")
    .eq("video_id", videoId)
    .order("position", { ascending: true });
  const ordered = rows ?? [];
  const i = ordered.findIndex((r) => r.id === id);
  const j = direction === "left" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ordered.length) return { ok: true as const };
  const a = ordered[i];
  const b = ordered[j];
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    supabase.from("carousel_images").update({ position: b.position }).eq("id", a.id),
    supabase.from("carousel_images").update({ position: a.position }).eq("id", b.id),
  ]);
  if (e1 || e2) return { error: (e1 ?? e2)!.message };
  revalidatePath(`/videos/${videoId}`);
  revalidatePath(`/videos/${videoId}/idea`);
  revalidatePath(`/videos/${videoId}/script`);
  revalidatePath(`/videos/${videoId}/editor-brief`);
  revalidatePath(`/videos/${videoId}/review`);
  return { ok: true as const };
}

export async function deleteCarouselImageAction(id: string, videoId: string) {
  await requireUser();
  const supabase = await supabaseServer();
  const { data: img } = await supabase
    .from("carousel_images")
    .select("storage_path")
    .eq("id", id)
    .single();
  if (img?.storage_path) await supabase.storage.from("carousels").remove([img.storage_path]);
  const { error } = await supabase.from("carousel_images").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/videos/${videoId}`);
  revalidatePath(`/videos/${videoId}/idea`);
  revalidatePath(`/videos/${videoId}/script`);
  revalidatePath(`/videos/${videoId}/editor-brief`);
  revalidatePath(`/videos/${videoId}/review`);
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// AI slide generation (migration 029). The slide's caption is the content;
// videos.carousel_style is the shared art direction; library shots ride along
// as reference frames so the result is grounded in the client's real footage.
// Generated PNGs land in the same `carousels` bucket, on the same row, as an
// upload would — the editor path and the AI path are interchangeable.
// ---------------------------------------------------------------------------

/** Shared art direction for every slide of this carousel. */
export async function saveCarouselStyleAction(videoId: string, style: string) {
  await requireRole("owner", "admin", "copywriter");
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("videos")
    .update({ carousel_style: style.trim() || null })
    .eq("id", videoId);
  if (error) return { error: error.message };
  revalidatePath(`/videos/${videoId}/idea`);
  revalidatePath(`/videos/${videoId}/script`);
  revalidatePath(`/videos/${videoId}/editor-brief`);
  return { ok: true };
}

/** Attach footage-index shots to a slide as visual references for generation. */
export async function setSlideRefsAction(id: string, videoId: string, refShotIds: string[]) {
  await requireRole("owner", "admin", "copywriter");
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("carousel_images")
    .update({ ref_shot_ids: refShotIds.slice(0, 4) })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/videos/${videoId}/idea`);
  revalidatePath(`/videos/${videoId}/script`);
  revalidatePath(`/videos/${videoId}/editor-brief`);
  return { ok: true };
}

const DEFAULT_STYLE =
  "Clean, bold, text-forward Instagram carousel slide. Solid or softly-textured background, " +
  "one strong typographic hierarchy, generous margins, high contrast, no watermark, no border.";

/**
 * Generate (or regenerate) one slide's image from its caption.
 *
 * With `changeNote` and an existing image, the current image is sent back as
 * a reference so the model adjusts the slide instead of starting over — the
 * "regenerate with a prompt" loop. Library-shot references (ref_shot_ids)
 * ride along either way. The old file is removed only after the new one is
 * safely registered.
 */
export async function generateCarouselSlideAction(
  id: string,
  videoId: string,
  changeNote?: string
) {
  await requireRole("owner", "admin", "copywriter");
  const supabase = await supabaseServer();

  const [{ data: slide }, { data: video }, { data: siblings }] = await Promise.all([
    supabase.from("carousel_images").select("*").eq("id", id).single(),
    supabase.from("videos").select("title, carousel_style").eq("id", videoId).single(),
    supabase
      .from("carousel_images")
      .select("position, caption")
      .eq("video_id", videoId)
      .order("position"),
  ]);
  if (!slide) return { error: "Slide not found." };
  if (!video) return { error: "Video not found." };
  const text = (slide.caption as string | null)?.trim();
  if (!text) return { error: "Write the slide's text first — the image is designed around it." };

  const all = siblings ?? [];
  const idx = all.findIndex((s) => s.position === slide.position);
  const n = idx >= 0 ? idx + 1 : (slide.position as number) + 1;

  const prompt = [
    `Design slide ${n} of ${all.length || n} for an Instagram carousel ("${video.title}").`,
    `Art direction: ${(video.carousel_style as string | null)?.trim() || DEFAULT_STYLE}`,
    `The slide must display this text, verbatim, correctly spelled, as the visual centrepiece:\n"${text}"`,
    "Compose safe for a 4:5 crop (keep everything important away from the top and bottom edges).",
    "Keep the look consistent with the rest of the carousel series.",
    changeNote?.trim() ? `Adjust from the current version: ${changeNote.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  // References: the current image (for continuity when regenerating) plus any
  // footage-index frames pinned to the slide.
  const references: { data: Buffer; mime: string; name: string }[] = [];
  if (slide.storage_path && changeNote?.trim()) {
    const { data: cur } = await supabase.storage.from("carousels").download(slide.storage_path as string);
    if (cur) references.push({ data: Buffer.from(await cur.arrayBuffer()), mime: "image/png", name: "current-slide.png" });
  }
  const refIds = (slide.ref_shot_ids as string[] | null) ?? [];
  if (refIds.length) {
    const { data: shots } = await supabase
      .from("library_shots")
      .select("id, thumb_path")
      .in("id", refIds);
    for (const s of shots ?? []) {
      if (!s.thumb_path) continue;
      const { data: blob } = await supabase.storage.from("library-thumbs").download(s.thumb_path as string);
      if (blob) references.push({ data: Buffer.from(await blob.arrayBuffer()), mime: "image/jpeg", name: `${s.id}.jpg` });
    }
  }

  let png: Buffer;
  try {
    png = await generateSlideImage({ prompt, references });
  } catch (e) {
    if (e instanceof NotConfiguredError) {
      return { error: "Add an OpenAI API key in Settings → Integrations to generate slides." };
    }
    return { error: (e as Error).message };
  }

  const newPath = `${videoId}/${crypto.randomUUID()}.png`;
  const { error: upErr } = await supabase.storage
    .from("carousels")
    .upload(newPath, png, { contentType: "image/png" });
  if (upErr) return { error: upErr.message };

  const oldPath = slide.storage_path as string | null;
  const me = await requireUser();
  const { error } = await supabase
    .from("carousel_images")
    .update({
      storage_path: newPath,
      size_bytes: png.length,
      uploaded_by: me.id,
      gen_prompt: changeNote?.trim() || "Generated from the slide text",
      gen_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    // Registration failed — don't leave the fresh upload orphaned.
    await supabase.storage.from("carousels").remove([newPath]);
    return { error: error.message };
  }
  if (oldPath && oldPath !== newPath) await supabase.storage.from("carousels").remove([oldPath]);

  revalidatePath(`/videos/${videoId}`);
  revalidatePath(`/videos/${videoId}/idea`);
  revalidatePath(`/videos/${videoId}/script`);
  revalidatePath(`/videos/${videoId}/editor-brief`);
  revalidatePath(`/videos/${videoId}/review`);
  return { ok: true };
}
