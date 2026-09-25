"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole, requireUser } from "@/lib/auth";
import { getWorkspaceSettings, integrationStatus } from "@/lib/workspace";
import { generateSlideImage, type ImageSize } from "@/lib/integrations/openai-images";
import { NotConfiguredError } from "@/lib/integrations/stream";

/**
 * Thumbnails — one per video, from any stage. A thumbnail is either uploaded
 * ready-made or designed by ChatGPT from a prompt plus reference images. The
 * references come from the B-Roll library (the Footage index) or are uploaded.
 *
 * All file handling goes through the service role after the caller's role has
 * been checked here; the browser only ever sees short-lived signed links.
 */

const BUCKET = "thumbnails";
const MAX_BYTES = 4 * 1024 * 1024; // Vercel's request body limit is 4.5 MB
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export interface ThumbnailRef {
  id: string;
  source: "library" | "upload";
  label: string | null;
  url: string | null;
}

export interface ThumbnailState {
  url: string | null;
  prompt: string;
  refs: ThumbnailRef[];
  canEdit: boolean;
  /** ChatGPT image generation needs an OpenAI key in Settings. */
  canGenerate: boolean;
  title: string;
}

const WRITERS = ["owner", "admin", "copywriter"] as const;

async function visibleVideo(videoId: string) {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("videos")
    .select("id, title, thumbnail_path, thumbnail_prompt, script_hooks, script_body, formats")
    .eq("id", videoId)
    .maybeSingle();
  return data;
}

async function signed(bucket: string, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabaseAdmin().storage.from(bucket).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

function revalidate(videoId: string) {
  revalidatePath(`/videos/${videoId}`);
  revalidatePath("/board");
}

export async function getThumbnailAction(videoId: string): Promise<ThumbnailState | null> {
  const me = await requireUser();
  const video = await visibleVideo(videoId);
  if (!video) return null;
  const db = supabaseAdmin();
  const [{ data: refs }, settings] = await Promise.all([
    db.from("video_thumbnail_refs").select("*").eq("video_id", videoId).order("position").order("created_at"),
    getWorkspaceSettings(),
  ]);
  const shotIds = (refs ?? []).filter((r) => r.source === "library" && r.shot_id).map((r) => r.shot_id as string);
  const { data: shots } = shotIds.length
    ? await db.from("library_shots").select("id, thumb_path, caption").in("id", shotIds)
    : { data: [] as { id: string; thumb_path: string | null; caption: string | null }[] };
  const shotById = new Map((shots ?? []).map((s) => [s.id, s]));

  const out: ThumbnailRef[] = [];
  for (const r of refs ?? []) {
    if (r.source === "library") {
      const shot = shotById.get(r.shot_id as string);
      out.push({
        id: r.id as string,
        source: "library",
        label: (r.label as string | null) ?? shot?.caption ?? null,
        url: await signed("library-thumbs", shot?.thumb_path ?? null),
      });
    } else {
      out.push({ id: r.id as string, source: "upload", label: r.label as string | null, url: await signed(BUCKET, r.storage_path as string | null) });
    }
  }
  return {
    url: await signed(BUCKET, video.thumbnail_path as string | null),
    prompt: (video.thumbnail_prompt as string | null) ?? "",
    refs: out,
    canEdit: (WRITERS as readonly string[]).includes(me.role),
    canGenerate: integrationStatus(settings).whisper, // the OpenAI key
    title: video.title as string,
  };
}

/** Add footage-index shots as references. */
export async function addLibraryRefsAction(videoId: string, shotIds: string[]) {
  const me = await requireRole(...WRITERS);
  if (!(await visibleVideo(videoId))) return { error: "Video not found." };
  const ids = [...new Set(shotIds)].slice(0, 8);
  if (!ids.length) return { error: "Pick at least one image." };
  const db = supabaseAdmin();
  const { data: existing } = await db.from("video_thumbnail_refs").select("shot_id, position").eq("video_id", videoId);
  const have = new Set((existing ?? []).map((r) => r.shot_id as string | null));
  let pos = Math.max(-1, ...(existing ?? []).map((r) => r.position as number)) + 1;
  const rows = ids
    .filter((id) => !have.has(id))
    .map((id) => ({ video_id: videoId, source: "library", shot_id: id, position: pos++, created_by: me.id }));
  if (rows.length) {
    const { error } = await db.from("video_thumbnail_refs").insert(rows);
    if (error) return { error: error.message };
  }
  revalidate(videoId);
  return { ok: true as const, added: rows.length };
}

function checkImage(file: File | null): string | null {
  if (!file || !file.size) return "Choose an image first.";
  if (!IMAGE_TYPES.includes(file.type)) return "Use a JPEG, PNG or WebP image.";
  if (file.size > MAX_BYTES) return "Keep it under 4 MB.";
  return null;
}

/** The browser's word for a file's type isn't proof: check the bytes really are that kind of image. */
async function sniffsAsImage(file: File): Promise<boolean> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const webp = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  return file.type === "image/jpeg" ? jpeg : file.type === "image/png" ? png : file.type === "image/webp" ? webp : false;
}

/** Upload your own image as a reference for the design. */
export async function uploadThumbnailRefAction(videoId: string, formData: FormData) {
  const me = await requireRole(...WRITERS);
  if (!(await visibleVideo(videoId))) return { error: "Video not found." };
  const files = formData.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) return { error: "Choose an image first." };
  const db = supabaseAdmin();
  const { data: existing } = await db.from("video_thumbnail_refs").select("position").eq("video_id", videoId);
  if ((existing?.length ?? 0) + files.length > 8) return { error: "A thumbnail can have up to 8 images. Remove one first." };
  let pos = Math.max(-1, ...(existing ?? []).map((r) => r.position as number)) + 1;
  let added = 0;
  const batch = files.slice(0, 8);
  // Check every file first so a bad third one doesn't leave the first two half-saved.
  if (batch.reduce((n, f) => n + f.size, 0) > MAX_BYTES) return { error: "Keep the images under 4 MB in total. Add them a few at a time." };
  for (const file of batch) {
    const bad = checkImage(file) ?? ((await sniffsAsImage(file)) ? null : "That doesn't look like a real image.");
    if (bad) return { error: `${file.name}: ${bad}` };
  }
  for (const file of batch) {
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${videoId}/refs/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await db.storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type });
    if (upErr) return { error: upErr.message };
    const { error } = await db
      .from("video_thumbnail_refs")
      .insert({ video_id: videoId, source: "upload", storage_path: path, label: file.name, position: pos++, created_by: me.id });
    if (error) {
      await db.storage.from(BUCKET).remove([path]);
      return { error: error.message };
    }
    added++;
  }
  revalidate(videoId);
  return { ok: true as const, added };
}

export async function removeThumbnailRefAction(videoId: string, refId: string) {
  await requireRole(...WRITERS);
  if (!(await visibleVideo(videoId))) return { error: "Video not found." };
  const db = supabaseAdmin();
  const { data: ref } = await db.from("video_thumbnail_refs").select("storage_path").eq("id", refId).eq("video_id", videoId).maybeSingle();
  await db.from("video_thumbnail_refs").delete().eq("id", refId).eq("video_id", videoId);
  if (ref?.storage_path) await db.storage.from(BUCKET).remove([ref.storage_path as string]);
  revalidate(videoId);
  return { ok: true as const };
}

/** The context for the design: what the thumbnail should say or show. */
export async function saveThumbnailPromptAction(videoId: string, prompt: string) {
  await requireRole(...WRITERS);
  if (!(await visibleVideo(videoId))) return { error: "Video not found." };
  const { error } = await supabaseAdmin()
    .from("videos")
    .update({ thumbnail_prompt: prompt.trim().slice(0, 2000) || null })
    .eq("id", videoId);
  if (error) return { error: error.message };
  return { ok: true as const };
}

async function setThumbnail(videoId: string, bytes: Buffer, contentType: string) {
  const db = supabaseAdmin();
  const { data: before } = await db.from("videos").select("thumbnail_path").eq("id", videoId).maybeSingle();
  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const path = `${videoId}/thumb-${Date.now()}.${ext}`;
  const { error: upErr } = await db.storage.from(BUCKET).upload(path, bytes, { contentType });
  if (upErr) return { error: upErr.message };
  const { error } = await db
    .from("videos")
    .update({ thumbnail_path: path, thumbnail_updated_at: new Date().toISOString() })
    .eq("id", videoId);
  if (error) {
    await db.storage.from(BUCKET).remove([path]);
    return { error: error.message };
  }
  if (before?.thumbnail_path) await db.storage.from(BUCKET).remove([before.thumbnail_path as string]);
  revalidate(videoId);
  return { ok: true as const };
}

/** Use a finished thumbnail you made yourself. */
export async function uploadFinalThumbnailAction(videoId: string, formData: FormData) {
  await requireRole(...WRITERS);
  if (!(await visibleVideo(videoId))) return { error: "Video not found." };
  const file = formData.get("file");
  const bad = checkImage(file instanceof File ? file : null) ?? ((await sniffsAsImage(file as File)) ? null : "That doesn't look like a real image.");
  if (bad) return { error: bad };
  const f = file as File;
  return setThumbnail(videoId, Buffer.from(await f.arrayBuffer()), f.type);
}

export async function clearThumbnailAction(videoId: string) {
  await requireRole(...WRITERS);
  if (!(await visibleVideo(videoId))) return { error: "Video not found." };
  const db = supabaseAdmin();
  const { data: v } = await db.from("videos").select("thumbnail_path").eq("id", videoId).maybeSingle();
  await db.from("videos").update({ thumbnail_path: null, thumbnail_updated_at: null }).eq("id", videoId);
  if (v?.thumbnail_path) await db.storage.from(BUCKET).remove([v.thumbnail_path as string]);
  revalidate(videoId);
  return { ok: true as const };
}

const PER_USER_PER_HOUR = 10;
const PER_WORKSPACE_PER_DAY = 60;

/** Record one design and return its ledger id, or the reason it isn't allowed. */
async function claimThumbnailDesign(db: ReturnType<typeof supabaseAdmin>, userId: string, videoId: string): Promise<{ error: string } | { id: string | null }> {
  const now = Date.now();
  const hourAgo = new Date(now - 3_600_000).toISOString();
  const dayAgo = new Date(now - 86_400_000).toISOString();
  const [{ count: mine }, { count: all }] = await Promise.all([
    db.from("thumbnail_generations").select("id", { count: "exact", head: true }).eq("created_by", userId).gte("created_at", hourAgo),
    db.from("thumbnail_generations").select("id", { count: "exact", head: true }).gte("created_at", dayAgo),
  ]);
  if ((mine ?? 0) >= PER_USER_PER_HOUR) return { error: `That's ${PER_USER_PER_HOUR} designs in the last hour. Wait a bit before making another.` };
  if ((all ?? 0) >= PER_WORKSPACE_PER_DAY) return { error: `The team has made ${PER_WORKSPACE_PER_DAY} thumbnail designs in the last day. Try again tomorrow, or upload a finished one.` };
  const { data } = await db.from("thumbnail_generations").insert({ video_id: videoId, created_by: userId }).select("id").single();
  return { id: (data?.id as string | undefined) ?? null };
}

/**
 * Design the thumbnail with ChatGPT. Everything attached goes in as a reference
 * image, and the prompt says what each is for: the person's own words are the
 * brief, the video's title and opening hook are the subject.
 */
export async function generateThumbnailAction(
  videoId: string,
  opts: { orientation?: "landscape" | "portrait"; note?: string } = {}
) {
  const me = await requireRole(...WRITERS);
  const video = await visibleVideo(videoId);
  if (!video) return { error: "Video not found." };
  const db = supabaseAdmin();

  // Every design spends the owner's OpenAI credits, so cap them: a few per person per hour, more per day overall.
  const claim = await claimThumbnailDesign(db, me.id, videoId);
  if ("error" in claim) return { error: claim.error };
  // A design that never reached OpenAI shouldn't count against the cap.
  const refund = async () => {
    if (claim.id) await db.from("thumbnail_generations").delete().eq("id", claim.id);
  };

  const { data: refs } = await db.from("video_thumbnail_refs").select("*").eq("video_id", videoId).order("position").limit(8);
  const references: { data: Buffer; mime: string; name: string }[] = [];
  for (const r of refs ?? []) {
    let blob: Blob | null = null;
    let mime = "image/jpeg";
    if (r.source === "library") {
      const { data: shot } = await db.from("library_shots").select("thumb_path").eq("id", r.shot_id as string).maybeSingle();
      if (shot?.thumb_path) blob = (await db.storage.from("library-thumbs").download(shot.thumb_path as string)).data;
    } else if (r.storage_path) {
      blob = (await db.storage.from(BUCKET).download(r.storage_path as string)).data;
      mime = blob?.type || (String(r.storage_path).endsWith(".png") ? "image/png" : "image/jpeg");
    }
    if (blob) references.push({ data: Buffer.from(await blob.arrayBuffer()), mime, name: `ref-${references.length + 1}.${mime.includes("png") ? "png" : "jpg"}` });
  }

  const hooks = (video.script_hooks as string[] | null) ?? [];
  const hook = hooks.find((h) => h?.trim()) ?? "";
  const brief = (video.thumbnail_prompt as string | null)?.trim();
  const landscape = (opts.orientation ?? "landscape") === "landscape";
  const size: ImageSize = landscape ? "1536x1024" : "1024x1536";

  const prompt = [
    `Design a ${landscape ? "landscape, wide (YouTube-style)" : "vertical 9:16"} video thumbnail for a video titled "${video.title}".`,
    hook ? `The video opens with: "${hook}"` : null,
    brief ? `The creator's brief, which comes first:\n${brief}` : null,
    references.length
      ? `Use the ${references.length} attached reference image${references.length === 1 ? "" : "s"} as the source material: build the design around them and keep any person recognisable. Do not invent a different person.`
      : "No reference images were attached: design from the brief alone.",
    "Make it bold and readable at a small size: one clear focal point, strong contrast, generous negative space. Use at most four words of on-image text, and only if the brief asks for text or the title would otherwise be unclear. Spell every word correctly.",
    opts.note?.trim() ? `Extra direction for this attempt: ${opts.note.trim().slice(0, 300)}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  let png: Buffer;
  try {
    png = await generateSlideImage({ prompt, references, size });
  } catch (e) {
    await refund();
    if (e instanceof NotConfiguredError) return { error: "Add an OpenAI API key in Settings → Integrations to design thumbnails with ChatGPT." };
    return { error: (e as Error).message };
  }
  return setThumbnail(videoId, png, "image/png");
}
