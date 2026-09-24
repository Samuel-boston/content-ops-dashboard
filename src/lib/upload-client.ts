"use client";

import { supabaseBrowser } from "@/lib/supabase/browser";
import type { CommentAttachment } from "@/lib/types";
import { sendWithProgress } from "@/lib/upload-progress";

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
  userId: string,
  onProgress?: (pct: number) => void
): Promise<CommentAttachment> {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "file";
  const path = `${userId}/${crypto.randomUUID()}-${safe}`;

  const contentType = file.type || "application/octet-stream";
  const sb = supabaseBrowser();
  const token = onProgress ? (await sb.auth.getSession()).data.session?.access_token : undefined;
  if (onProgress && token) {
    // The client library can't report upload progress; the same request sent
    // by hand can. Same endpoint, same policy check.
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    await sendWithProgress(`${base}/storage/v1/object/${BUCKET}/${path}`, file, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: key ?? "", "Content-Type": contentType },
      onProgress,
    });
  } else {
    const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType });
    if (error) throw new Error(error.message);
  }

  return { path, name: filename, size: file.size, type: file.type || "application/octet-stream" };
}
