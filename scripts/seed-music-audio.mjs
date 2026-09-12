#!/usr/bin/env node
// The demo music rows had no audio behind them, so the library's play button
// was permanently disabled. This generates a short, distinct tone per track so
// preview, scrubbing and the waveform are all actually demonstrable.
//
//   node scripts/seed-music-audio.mjs

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

/** A short loop built from a chord, so each track sounds different. */
function toneWav(rootHz, seconds = 12, rate = 8000) {
  const n = rate * seconds;
  const data = Buffer.alloc(n * 2);
  const thirds = [1, 1.25, 1.5];
  for (let i = 0; i < n; i += 1) {
    const t = i / rate;
    // Slow pulse so the waveform and progress bar have visible movement.
    const pulse = 0.55 + 0.45 * Math.sin(t * Math.PI * 1.2);
    const fade = Math.min(1, t * 1.5, (seconds - t) * 1.5);
    let v = 0;
    for (const m of thirds) v += Math.sin(2 * Math.PI * rootHz * m * t) / thirds.length;
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * pulse * fade * 0.4)) * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const MOODS = ["Upbeat", "Chill", "Dramatic", "Corporate", "Cinematic", "Emotional"];
const ENERGY = ["Low", "Medium", "High"];

const main = async () => {
  const { data: tracks, error } = await db.from("music_tracks").select("id, title, storage_path");
  if (error) throw new Error(error.message);

  let uploaded = 0;
  for (const [i, t] of tracks.entries()) {
    const root = 160 + (i % 9) * 35;
    const seconds = 10 + (i % 5) * 4;
    const { error: upErr } = await db.storage
      .from("music")
      .upload(t.storage_path, toneWav(root, seconds), {
        contentType: "audio/wav",
        upsert: true,
      });
    if (upErr) {
      console.warn(`  ! ${t.title}: ${upErr.message}`);
      continue;
    }
    await db
      .from("music_tracks")
      .update({
        duration_seconds: seconds,
        mood: MOODS[i % MOODS.length],
        energy: ENERGY[i % ENERGY.length],
        bpm: 80 + (i % 8) * 10,
      })
      .eq("id", t.id);
    uploaded += 1;
  }

  // Attach a couple of tracks to videos so "where it's been used" isn't empty.
  const { data: videos } = await db
    .from("videos")
    .select("id")
    .neq("status", "posted")
    .limit(3);
  let links = 0;
  for (const [i, v] of (videos ?? []).entries()) {
    const track = tracks[i];
    if (!track) continue;
    const { error: linkErr } = await db
      .from("video_music")
      .upsert({ video_id: v.id, track_id: track.id }, { onConflict: "video_id,track_id" });
    if (!linkErr) links += 1;
  }

  console.log(`✓ audio uploaded for ${uploaded}/${tracks.length} tracks`);
  console.log(`✓ ${links} tracks attached to videos`);
};

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
