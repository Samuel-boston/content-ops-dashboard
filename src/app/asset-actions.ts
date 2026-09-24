"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth";
import { getWorkspaceSettings } from "@/lib/workspace";
import type { VideoActivity, VideoAsset } from "@/lib/types";

// ---------------------------------------------------------------------------
// Raw footage & source files.
//
// Raw footage never needs Stream's scrubbing/comments, so it goes to Drive
// (per the infrastructure decision). Until Drive is configured it lands in a
// private Supabase Storage bucket and is mirrored to Drive later, so the
// team is never blocked on an integration.
// ---------------------------------------------------------------------------

export async function listAssets(videoId: string): Promise<VideoAsset[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("video_assets")
    .select("*")
    .eq("video_id", videoId)
    .order("created_at", { ascending: false });
  const rows = (data as VideoAsset[]) ?? [];
  return Promise.all(
    rows.map(async (a) => {
      if (a.storage_path && !a.drive_url) {
        const { data: signed } = await supabase.storage
          .from("footage")
          .createSignedUrl(a.storage_path, 3600);
        return { ...a, signed_url: signed?.signedUrl };
      }
      return a;
    })
  );
}

export async function createFootageUploadUrlAction(videoId: string, filename: string) {
  await requireUser();
  const supabase = await supabaseServer();
  const ext = filename.split(".").pop()?.toLowerCase() || "mp4";
  const path = `${videoId}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await supabase.storage.from("footage").createSignedUploadUrl(path);
  if (error) return { error: error.message };
  return { ok: true as const, path, signedUrl: data.signedUrl };
}

export async function registerAssetAction(input: {
  videoId: string;
  label: string;
  storagePath?: string | null;
  externalUrl?: string | null;
  sizeBytes?: number | null;
  /** "raw" (default) mirrors to Drive like any source file; "other" is a
   * supporting asset — a screen recording for the editors, say — that stays
   * in Storage only. "delivery" is a finished-video link from the editor. */
  kind?: "raw" | "other" | "delivery";
}) {
  const me = await requireUser();
  const kind = input.kind ?? "raw";
  const supabase = await supabaseServer();
  const { error } = await supabase.from("video_assets").insert({
    video_id: input.videoId,
    kind,
    label:
      input.label.trim() ||
      (kind === "raw" ? "Raw footage" : kind === "delivery" ? "Finished video" : "Attachment"),
    storage_path: input.storagePath ?? null,
    external_url: input.externalUrl ?? null,
    size_bytes: input.sizeBytes ?? null,
    added_by: me.id,
  });
  if (error) return { error: error.message };

  await logActivity(input.videoId, me.id, "version", `Added ${
      kind === "raw" ? "footage" : kind === "delivery" ? "a finished-video link" : "an attachment"
    } “${input.label.trim() || "Untitled"}”`);

  // If Drive is configured, mirror it across in the background so raw footage
  // ends up where the infrastructure plan says it should live. Supporting
  // assets aren't source material, so they stay put.
  // after(): a bare floating promise is frozen once the response is sent on a
  // serverless host, so the copy to Drive could silently never finish.
  if (input.storagePath && kind === "raw") {
    const path = input.storagePath;
    const label = input.label.trim();
    after(() => mirrorFootageToDrive(input.videoId, path, label));
  }

  revalidatePath(`/videos/${input.videoId}`);
  return { ok: true as const };
}

export async function deleteAssetAction(id: string, videoId: string) {
  await requireUser();
  const supabase = await supabaseServer();
  const { data: a } = await supabase
    .from("video_assets")
    .select("storage_path")
    .eq("id", id)
    .single();
  if (a?.storage_path) await supabase.storage.from("footage").remove([a.storage_path]);
  const { error } = await supabase.from("video_assets").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/videos/${videoId}`);
  return { ok: true as const };
}

async function mirrorFootageToDrive(videoId: string, storagePath: string, label?: string) {
  try {
    const s = await getWorkspaceSettings();
    if (!s.drive_folder_id || !s.drive_service_account) return;
    const db = supabaseAdmin();
    const { data: signed } = await db.storage.from("footage").createSignedUrl(storagePath, 900);
    if (!signed?.signedUrl) return;
    const { uploadFromUrl } = await import("@/lib/integrations/drive");
    // Named after the file as it was uploaded, not the random storage key.
    const name = label || (storagePath.split("/").pop() ?? "footage.mp4");
    const link = await uploadFromUrl(signed.signedUrl, name);
    await db.from("video_assets").update({ drive_url: link }).eq("storage_path", storagePath);
    // Storage copy is redundant once Drive holds it.
    await db.storage.from("footage").remove([storagePath]);
    await db.from("video_assets").update({ storage_path: null }).eq("storage_path", storagePath);
  } catch {
    /* Drive unavailable — the Storage copy stays as the source of truth. */
  }
}

// ---------------------------------------------------------------------------
// Activity trail
// ---------------------------------------------------------------------------

export async function listActivity(videoId: string, limit = 30): Promise<VideoActivity[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("video_activity")
    .select("*, actor:profiles!video_activity_actor_id_fkey (id, full_name, email)")
    .eq("video_id", videoId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as VideoActivity[]) ?? [];
}

/** Server-side helper — DB triggers cover status/assignment/priority already. */
export async function logActivity(
  videoId: string,
  actorId: string | null,
  kind: string,
  summary: string
) {
  try {
    await supabaseAdmin()
      .from("video_activity")
      .insert({ video_id: videoId, actor_id: actorId, kind, summary });
  } catch {
    /* non-critical */
  }
}
