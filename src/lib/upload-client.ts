"use client";

import { supabaseBrowser } from "@/lib/supabase/browser";
import type { CommentAttachment } from "@/lib/types";

const BUCKET = "comment-media";

/**
 * Upload a voice note or attachment straight from the browser to Supabase
 * Storage. Bytes never route through our server; the storage RLS policy is
 * what authorises the write, and reads come back as signed URLs minted
 * server-side when a thread is loaded.
 */
export async function uploadCommentMedia(
  file: Blob,
  filename: string,
  userId: string
): Promise<CommentAttachment> {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "file";
  const path = `${userId}/${crypto.randomUUID()}-${safe}`;

  const { error } = await supabaseBrowser()
    .storage.from(BUCKET)
    .upload(path, file, { contentType: file.type || "application/octet-stream" });
  if (error) throw new Error(error.message);

  return { path, name: filename, size: file.size, type: file.type || "application/octet-stream" };
}
