import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  driveSession,
  ensureFolder,
  ensureTaggedFolder,
  moveDriveFile,
  driveFileIdFromLink,
  putBytes,
} from "@/lib/integrations/drive";

/**
 * How the Drive archive is laid out:
 *
 *   <configured folder>/
 *     2026-09 September/            one folder per month (by post date)
 *       <Video title>/              one folder per video
 *         Finished video/           the cut(s), untouched as uploaded
 *         Raw footage/              every raw clip
 *         Carousel slides/          carousels only
 *         Script.txt
 *         Caption.txt
 *         Cover.jpg
 *         Info.txt
 *
 * The video folder is tagged with the video's id, so it is found again (and
 * moved to the right month) even if the title changes later.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export type VideoSubfolder = "Finished video" | "Raw footage" | "Carousel slides";

const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled";

function monthFolderName(iso: string | null | undefined): string {
  const d = iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso) : new Date();
  const ok = Number.isNaN(d.getTime()) ? new Date() : d;
  return `${ok.getUTCFullYear()}-${String(ok.getUTCMonth() + 1).padStart(2, "0")} ${MONTHS[ok.getUTCMonth()]}`;
}

export interface VideoFolder {
  token: string;
  /** The video's own folder. */
  id: string;
  link: string;
  /** Folder id of a subfolder, created on demand. */
  sub: (name: VideoSubfolder) => Promise<string>;
}

/** Finds or creates the video's folder under its month. Throws NotConfiguredError when Drive isn't connected. */
export async function videoFolder(videoId: string): Promise<VideoFolder> {
  const { token, rootId } = await driveSession();
  const { data: v } = await supabaseAdmin()
    .from("videos")
    .select("title, post_date, posted_at, created_at")
    .eq("id", videoId)
    .single();
  if (!v) throw new Error("Video not found");
  const month = await ensureFolder(token, rootId, monthFolderName(v.post_date ?? v.posted_at ?? v.created_at));
  const folder = await ensureTaggedFolder(token, month, clean(v.title as string), videoId);
  const cache = new Map<string, string>();
  return {
    token,
    id: folder.id,
    link: folder.link,
    sub: async (name) => {
      if (!cache.has(name)) cache.set(name, await ensureFolder(token, folder.id, name));
      return cache.get(name)!;
    },
  };
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "—");

/**
 * Writes/refreshes everything that belongs in a video's folder except the cut
 * files themselves: script, caption, info, cover, carousel slides — and pulls
 * any raw footage already in Drive (mirrored on upload) into "Raw footage".
 * Returns the folder link.
 */
export async function syncVideoFolder(videoId: string): Promise<string> {
  const db = supabaseAdmin();
  const folder = await videoFolder(videoId);
  const { data: v } = await db
    .from("videos")
    .select(
      "title, status, priority, formats, content_pillars, platforms, post_date, posted_at, brief, idea_notes, script_hooks, script_body, script_cta, cover_path, assigned_editor:profiles!videos_assigned_editor_id_fkey (full_name, email)"
    )
    .eq("id", videoId)
    .single();
  if (!v) return folder.link;

  // Script
  const hooks = (v.script_hooks as string[] | null)?.filter(Boolean) ?? [];
  const script = [
    (v.title as string).toUpperCase(),
    hooks.length ? `HOOK${hooks.length > 1 ? "S" : ""}\n${hooks.map((h, i) => (hooks.length > 1 ? `${i + 1}. ${h}` : h)).join("\n")}` : "",
    v.script_body ? `SCRIPT\n${v.script_body}` : "",
    v.script_cta ? `CALL TO ACTION\n${v.script_cta}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  if (script.trim() && (hooks.length || v.script_body || v.script_cta)) {
    await putBytes(folder.token, folder.id, "Script.txt", Buffer.from(script + "\n", "utf8"), "text/plain");
  }

  // Caption — what actually went out, else the latest caption on file.
  const [{ data: jobs }, { data: trials }] = await Promise.all([
    db.from("publish_jobs").select("caption, status, published_at, created_at").eq("video_id", videoId).order("created_at", { ascending: false }),
    db.from("trial_posts").select("label, caption, post_as, status, permalink, posted_at").eq("video_id", videoId).order("created_at", { ascending: true }),
  ]);
  const sentJob = jobs?.find((j) => j.status === "published" && j.caption) ?? jobs?.find((j) => j.caption);
  const caption =
    sentJob?.caption ??
    (trials ?? []).filter((t) => t.post_as !== "trial").map((t) => t.caption).find(Boolean) ??
    (trials ?? []).map((t) => t.caption).find(Boolean) ??
    null;
  if (caption) await putBytes(folder.token, folder.id, "Caption.txt", Buffer.from(`${caption}\n`, "utf8"), "text/plain");

  // Cover
  if (v.cover_path) {
    const { data: signed } = await db.storage.from("footage").createSignedUrl(v.cover_path as string, 600);
    if (signed?.signedUrl) {
      const res = await fetch(signed.signedUrl);
      if (res.ok) {
        const ext = (v.cover_path as string).split(".").pop()?.toLowerCase() || "jpg";
        await putBytes(
          folder.token,
          folder.id,
          `Cover.${ext}`,
          Buffer.from(await res.arrayBuffer()),
          res.headers.get("content-type") ?? "image/jpeg"
        );
      }
    }
  }

  // Carousel slides
  const { data: slides } = await db
    .from("carousel_images")
    .select("position, storage_path, caption")
    .eq("video_id", videoId)
    .order("position", { ascending: true });
  const withFiles = (slides ?? []).filter((s) => s.storage_path);
  if (withFiles.length) {
    const subId = await folder.sub("Carousel slides");
    for (const [i, s] of withFiles.entries()) {
      const { data: signed } = await db.storage.from("footage").createSignedUrl(s.storage_path as string, 600);
      if (!signed?.signedUrl) continue;
      const res = await fetch(signed.signedUrl);
      if (!res.ok) continue;
      const ext = (s.storage_path as string).split(".").pop()?.toLowerCase() || "png";
      await putBytes(
        folder.token,
        subId,
        `Slide ${String(i + 1).padStart(2, "0")}.${ext}`,
        Buffer.from(await res.arrayBuffer()),
        res.headers.get("content-type") ?? "image/png"
      );
    }
  }

  // Raw footage that was mirrored to Drive at upload time → into "Raw footage".
  const { data: raws } = await db.from("video_assets").select("drive_url, storage_path, label").eq("video_id", videoId).eq("kind", "raw");
  const rawDest = (raws ?? []).some((r) => r.drive_url || r.storage_path) ? await folder.sub("Raw footage") : null;
  for (const r of raws ?? []) {
    if (!rawDest) break;
    if (r.drive_url) {
      const id = driveFileIdFromLink(r.drive_url as string);
      if (id) await moveDriveFile(folder.token, id, rawDest).catch(() => {});
    } else if (r.storage_path) {
      const { data: signed } = await db.storage.from("footage").createSignedUrl(r.storage_path as string, 900);
      if (!signed?.signedUrl) continue;
      const res = await fetch(signed.signedUrl);
      if (!res.ok) continue;
      const name = (r.label as string) || (r.storage_path as string).split("/").pop() || "footage";
      await putBytes(folder.token, rawDest, name, Buffer.from(await res.arrayBuffer()), res.headers.get("content-type") ?? "application/octet-stream", false);
    }
  }

  // Info
  const editor = v.assigned_editor as unknown as { full_name: string | null; email: string } | null;
  const posts = (trials ?? [])
    .filter((t) => t.status === "posted")
    .map((t) => `  - ${t.label} (${t.post_as === "trial" ? "trial reel" : "main feed"}) — ${fmtDate(t.posted_at as string | null)}${t.permalink ? ` — ${t.permalink}` : ""}`);
  const info = [
    `Title: ${v.title}`,
    `Status: ${v.status}`,
    `Format: ${(v.formats as string[])?.join(", ") || "—"}`,
    `Pillars: ${(v.content_pillars as string[])?.join(", ") || "—"}`,
    `Platforms: ${(v.platforms as string[])?.join(", ") || "—"}`,
    `Editor: ${editor?.full_name || editor?.email || "—"}`,
    `Post date: ${fmtDate((v.post_date as string | null) ?? null)}`,
    `Posted: ${fmtDate((v.posted_at as string | null) ?? null)}`,
    posts.length ? `Posts:\n${posts.join("\n")}` : "",
    v.brief ? `\nBrief:\n${v.brief}` : "",
    `\nLast updated: ${new Date().toISOString().slice(0, 10)}`,
  ]
    .filter(Boolean)
    .join("\n");
  await putBytes(folder.token, folder.id, "Info.txt", Buffer.from(info + "\n", "utf8"), "text/plain");

  return folder.link;
}
