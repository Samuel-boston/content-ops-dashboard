import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { uploadBackupJson } from "@/lib/integrations/drive";
import { NotConfiguredError } from "@/lib/integrations/stream";

/**
 * Everything worth restoring if the database ever disappeared — every table
 * except the two that hold live secrets or trivially-regenerable tokens.
 * `workspace_settings` (Cloudflare/Drive/Instagram/Telegram/OpenAI
 * credentials, some in plaintext) and `personal_access_tokens` (hashed, but
 * still credentials) are deliberately left out: this file lands in Drive,
 * which is shared more widely than the database itself, and losing either
 * table just means re-entering a few keys in Settings, not losing work.
 */
const BACKUP_TABLES = [
  "profiles",
  "videos",
  "video_cuts",
  "cut_versions",
  "cut_comments",
  "cut_transcripts",
  "video_assets",
  "video_activity",
  "video_metrics",
  "video_messages",
  "video_music",
  "carousel_images",
  "reference_items",
  "guest_links",
  "series",
  "hook_snippets",
  "music_tracks",
  "broll_categories",
  "taxonomy_options",
  "cadence_slots",
  "sop_docs",
  "publish_jobs",
  "notifications",
  "automation_events",
  "editor_rates",
  "editor_payments",
  "editor_month_billing",
  "editor_payment_details",
  "editor_time_off",
  "trial_posts",
  "va_tasks",
  "script_comments",
] as const;

export interface BackupResult {
  ok: boolean;
  error?: string;
  tables?: number;
  rows?: number;
  link?: string;
}

/**
 * Dumps every content table to one JSON file and uploads it to the same
 * Google Drive account already used for footage — an independent, off-Supabase
 * copy of everything, so a database-side accident isn't the only place the
 * work exists. Best-effort per table: one failing table doesn't lose the rest.
 */
export async function runBackupJob(): Promise<BackupResult> {
  const db = supabaseAdmin();
  const tables: Record<string, unknown[]> = {};
  let rows = 0;

  for (const table of BACKUP_TABLES) {
    const { data, error } = await db.from(table).select("*");
    if (error) {
      tables[table] = [{ _error: error.message }];
      continue;
    }
    tables[table] = data ?? [];
    rows += data?.length ?? 0;
  }

  const payload = {
    generated_at: new Date().toISOString(),
    source: "content-ops-dashboard",
    tables,
  };
  const name = `content-ops-backup-${new Date().toISOString().slice(0, 10)}.json`;

  try {
    const link = await uploadBackupJson(name, JSON.stringify(payload));
    await db.from("automation_events").insert({
      kind: "backup",
      detail: { tables: BACKUP_TABLES.length, rows, link },
    });
    return { ok: true, tables: BACKUP_TABLES.length, rows, link };
  } catch (e) {
    const error = e instanceof NotConfiguredError ? "Google Drive isn't connected yet." : (e as Error).message;
    await db.from("automation_events").insert({ kind: "backup", detail: { error } });
    return { ok: false, error };
  }
}
