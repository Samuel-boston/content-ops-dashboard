#!/usr/bin/env node
// Manual fallback. The B-Roll Librarian now syncs itself once connected
// (`broll connect-dashboard`); use this only to push from a local database by hand.
//
// Mirror the B-Roll Librarian archive into the dashboard's footage index.
//
//   node scripts/sync-broll-library.mjs [--workspace test] [--db /path/to/library.db] [--prune]
//
// Reads the librarian's SQLite (read-only, via the sqlite3 CLI that ships
// with macOS — no native npm dependency), upserts every indexed shot into
// `library_shots` (migration 030), and uploads each shot's thumbnail frame to
// the `library-thumbs` bucket. Run it on the machine that runs the librarian,
// after an indexing session. Idempotent: re-running updates in place.
//
// --prune also deletes dashboard rows whose shot no longer exists in the
// librarian (skipped when the librarian returns nothing, so an empty/typo'd
// --db can never wipe the index).

import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1]?.startsWith("--") || args[i + 1] === undefined ? true : args[i + 1]) : undefined;
};

const workspace = typeof flag("workspace") === "string" ? flag("workspace") : "test";
const brollHome = process.env.BROLL_HOME || join(homedir(), ".broll");
const dbPath = typeof flag("db") === "string" ? flag("db") : join(brollHome, "workspaces", workspace, "library.db");
const thumbsDir = join(brollHome, "workspaces", workspace, "thumbnails");
const prune = flag("prune") === true;

if (!existsSync(dbPath)) {
  console.error(`No librarian database at ${dbPath} — is the workspace name right?`);
  process.exit(1);
}

// One flat query: every indexed shot joined with its source's Drive location.
const SQL = `
  select
    s.id, s.source_id, s.start_s, s.end_s, s.duration_s, s.caption, s.action,
    s.setting, s.shot_type, s.emotions_json, s.subjects_json, s.category,
    s.top_pick, s.featured_person, s.search_text, s.thumbnail_path,
    src.media_kind, src.original_filename, src.drive_file_id,
    src.drive_web_link, src.drive_path
  from shots s
  join sources src on src.id = s.source_id
  where s.status = 'indexed'
`;

let rows;
try {
  const out = execFileSync("sqlite3", ["-readonly", "-json", dbPath, SQL], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  rows = out.trim() ? JSON.parse(out) : [];
} catch (e) {
  console.error("Reading the librarian database failed:", e.message);
  process.exit(1);
}
console.log(`Librarian: ${rows.length} indexed shots in workspace "${workspace}"`);

const parseArr = (s) => {
  try {
    const v = JSON.parse(s ?? "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

const supabase = createClient(url, key);
const ids = new Set();
let thumbs = 0;
const records = [];

for (const r of rows) {
  ids.add(r.id);
  let thumb_path = null;
  // Thumbnails are deterministic: <shot id>.jpg both locally and in the bucket.
  const local = r.thumbnail_path && existsSync(r.thumbnail_path) ? r.thumbnail_path : join(thumbsDir, `${r.id}.jpg`);
  if (existsSync(local)) {
    thumb_path = `${r.id}.jpg`;
    const { error } = await supabase.storage
      .from("library-thumbs")
      .upload(thumb_path, readFileSync(local), { contentType: "image/jpeg", upsert: true });
    if (error) {
      console.warn(`  thumb failed for ${r.id}: ${error.message}`);
      thumb_path = null;
    } else {
      thumbs++;
    }
  }
  records.push({
    id: r.id,
    source_id: r.source_id,
    media_kind: r.media_kind === "image" ? "image" : "video",
    filename: r.original_filename ?? null,
    caption: r.caption ?? null,
    action: r.action ?? null,
    setting: r.setting ?? null,
    shot_type: r.shot_type ?? null,
    emotions: parseArr(r.emotions_json),
    subjects: parseArr(r.subjects_json),
    category: r.category ?? null,
    featured_person: Boolean(r.featured_person),
    top_pick: Boolean(r.top_pick),
    start_s: r.start_s ?? null,
    end_s: r.end_s ?? null,
    duration_s: r.duration_s ?? null,
    drive_file_id: r.drive_file_id ?? null,
    drive_web_link: r.drive_web_link ?? null,
    drive_path: r.drive_path ?? null,
    thumb_path,
    search_text: r.search_text ?? null,
    synced_at: new Date().toISOString(),
  });
}

for (let i = 0; i < records.length; i += 200) {
  const chunk = records.slice(i, i + 200);
  const { error } = await supabase.from("library_shots").upsert(chunk, { onConflict: "id" });
  if (error) {
    console.error("Upsert failed:", error.message);
    process.exit(1);
  }
}
console.log(`Synced ${records.length} shots (${thumbs} thumbnails).`);

if (prune && ids.size > 0) {
  const { data: existing } = await supabase.from("library_shots").select("id");
  const stale = (existing ?? []).map((r) => r.id).filter((id) => !ids.has(id));
  if (stale.length) {
    await supabase.from("library_shots").delete().in("id", stale);
    await supabase.storage.from("library-thumbs").remove(stale.map((id) => `${id}.jpg`));
    console.log(`Pruned ${stale.length} shots the librarian no longer has.`);
  } else {
    console.log("Nothing to prune.");
  }
}
console.log("Done.");
