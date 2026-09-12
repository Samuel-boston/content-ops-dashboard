"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
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

export async function registerCarouselImageAction(input: {
  videoId: string;
  storagePath: string;
  sizeBytes?: number | null;
}) {
  const me = await requireUser();
  const supabase = await supabaseServer();
  // Append to the end — carousels display in upload order.
  const { count } = await supabase
    .from("carousel_images")
    .select("id", { count: "exact", head: true })
    .eq("video_id", input.videoId);
  const { error } = await supabase.from("carousel_images").insert({
    video_id: input.videoId,
    position: count ?? 0,
    storage_path: input.storagePath,
    size_bytes: input.sizeBytes ?? null,
    uploaded_by: me.id,
  });
  if (error) return { error: error.message };
  revalidatePath(`/videos/${input.videoId}`);
  revalidatePath(`/videos/${input.videoId}/review`);
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
  revalidatePath(`/videos/${videoId}/review`);
  return { ok: true as const };
}
