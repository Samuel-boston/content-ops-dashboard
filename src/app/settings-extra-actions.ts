"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole, requireUser } from "@/lib/auth";
import { runBackupJob, type BackupResult } from "@/lib/backup";

/** Everyone chooses how much they want to hear from the dashboard. */
export async function setNotifyModeAction(mode: "realtime" | "digest" | "off") {
  const me = await requireUser();
  if (!["realtime", "digest", "off"].includes(mode)) return { error: "Unknown setting." };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("profiles").update({ notify_mode: mode }).eq("id", me.id);
  if (error) return { error: error.message };
  revalidatePath("/notifications");
  return { ok: true };
}

export interface BucketUsage {
  bucket: string;
  files: number;
  bytes: number;
  /** True when we stopped counting — the real figure is at least this much. */
  truncated: boolean;
}

const PAGE = 1000;
/** Hard stop so a huge bucket can't turn this page into a long-running query. */
const MAX_PAGES = 10;

/**
 * What's using space, per bucket.
 *
 * Storage has no aggregate size endpoint, so this walks the object list. The
 * `footage` bucket is nested one folder deep (one per video), so it's walked
 * accordingly; the rest are flat.
 */
export async function storageUsage(): Promise<BucketUsage[]> {
  await requireRole("owner", "admin");
  const db = supabaseAdmin();
  const buckets = ["footage", "music", "references", "comment-media"];

  return Promise.all(
    buckets.map(async (bucket) => {
      let files = 0;
      let bytes = 0;
      let truncated = false;

      const walk = async (prefix: string): Promise<{ folders: string[] }> => {
        const folders: string[] = [];
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const { data, error } = await db.storage
            .from(bucket)
            .list(prefix, { limit: PAGE, offset: page * PAGE });
          if (error || !data) break;
          for (const item of data) {
            // A row with no id is a folder placeholder, not an object.
            if (!item.id) folders.push(prefix ? `${prefix}/${item.name}` : item.name);
            else {
              files += 1;
              bytes += (item.metadata?.size as number) ?? 0;
            }
          }
          if (data.length < PAGE) return { folders };
          if (page === MAX_PAGES - 1) truncated = true;
        }
        return { folders };
      };

      const { folders } = await walk("");
      // One level down is enough: footage is keyed by video id.
      for (const folder of folders.slice(0, 200)) await walk(folder);

      return { bucket, files, bytes, truncated };
    })
  );
}

export interface LastBackup {
  at: string;
  ok: boolean;
  rows?: number;
  link?: string;
  error?: string;
}

/** What the daily cron backup last did — read straight off its own log row. */
export async function lastBackup(): Promise<LastBackup | null> {
  await requireRole("owner", "admin");
  const db = supabaseAdmin();
  const { data } = await db
    .from("automation_events")
    .select("created_at, detail")
    .eq("kind", "backup")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const d = (data.detail ?? {}) as { rows?: number; link?: string; error?: string };
  return { at: data.created_at as string, ok: !d.error, rows: d.rows, link: d.link, error: d.error };
}

/** A manual "back up now" — same job the daily cron runs, for peace of mind without waiting for 3am. */
export async function backupNowAction(): Promise<BackupResult> {
  await requireRole("owner", "admin");
  const res = await runBackupJob();
  revalidatePath("/settings");
  return res;
}
