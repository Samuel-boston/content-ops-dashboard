#!/usr/bin/env node
// Demo content for the review workspace: a drawn annotation, a voice note, an
// attachment, a transcript, and comment metadata (visibility / assignee).
// Idempotent — re-running replaces what it created rather than duplicating.
//
//   node scripts/seed-workspace-demo.mjs

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BUCKET = "comment-media";

/** Build a mono 8kHz WAV whose envelope reads like speech on the waveform. */
function speechLikeWav(seconds = 4) {
  const rate = 8000;
  const n = rate * seconds;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i += 1) {
    const t = i / rate;
    // Syllable-rate envelope (~4 Hz) with a slow fade in and out.
    const syllable = Math.max(0, Math.sin(t * Math.PI * 4)) ** 2;
    const fade = Math.min(1, t * 2, (seconds - t) * 2);
    // Two formant-ish tones plus a little breath noise.
    const tone =
      0.6 * Math.sin(2 * Math.PI * 180 * t) +
      0.3 * Math.sin(2 * Math.PI * 420 * t) +
      0.1 * (Math.random() * 2 - 1);
    const v = Math.max(-1, Math.min(1, tone * syllable * fade * 0.7));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Peaks matching the envelope above, ~10/second. */
function speechLikePeaks(seconds = 4) {
  const out = [];
  for (let i = 0; i < seconds * 10; i += 1) {
    const t = i / 10;
    const syllable = Math.max(0, Math.sin(t * Math.PI * 4)) ** 2;
    const fade = Math.min(1, t * 2, (seconds - t) * 2);
    out.push(Math.min(1, syllable * fade * 0.9 + Math.random() * 0.12));
  }
  return out;
}

async function upload(path, body, contentType) {
  const { error } = await db.storage
    .from(BUCKET)
    .upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`${path}: ${error.message}`);
  return path;
}

const main = async () => {
  const { data: people } = await db.from("profiles").select("id, email, role, full_name");
  const owner = people.find((p) => p.role === "owner");
  const admin = people.find((p) => p.role === "admin");
  const ed1 = people.find((p) => p.email === "editor1@example.com");
  if (!owner) throw new Error("No owner profile — run scripts/seed.mjs first.");

  const { data: hero } = await db
    .from("videos")
    .select("id, title")
    .eq("title", "Client testimonial — Q3 launch")
    .maybeSingle();
  if (!hero) throw new Error("Demo video missing — run scripts/seed-demo.mjs first.");

  const { data: mainCut } = await db
    .from("video_cuts")
    .select("id")
    .eq("video_id", hero.id)
    .eq("kind", "main")
    .single();

  // --- existing comments get visibility + an assignee -----------------------
  const { data: existing } = await db
    .from("cut_comments")
    .select("id, t_start_seconds")
    .eq("cut_id", mainCut.id)
    .is("parent_comment_id", null)
    .order("created_at");

  if (existing?.length) {
    await db
      .from("cut_comments")
      .update({ visibility: "client" })
      .eq("id", existing[0].id);
    if (existing[1] && ed1) {
      await db
        .from("cut_comments")
        .update({ assignee_id: ed1.id })
        .eq("id", existing[1].id);
    }
  }

  // --- drawn annotation -----------------------------------------------------
  // A rough ellipse around the middle of the frame plus an arrow into it —
  // normalised 0..1, exactly what DrawLayer produces.
  const ellipse = [];
  for (let a = 0; a <= Math.PI * 2 + 0.1; a += 0.22) {
    ellipse.push([0.5 + Math.cos(a) * 0.22, 0.52 + Math.sin(a) * 0.14]);
  }
  const drawing = {
    strokes: [
      { color: "#7c5cff", width: 3, points: ellipse.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]) },
      {
        color: "#f4515f",
        width: 3,
        points: [
          [0.83, 0.8],
          [0.75, 0.72],
          [0.68, 0.65],
        ],
      },
    ],
  };

  await db.from("cut_comments").delete().eq("cut_id", mainCut.id).eq("body", "Change the text colour to red here — it's fighting the background.");
  await db.from("cut_comments").insert({
    cut_id: mainCut.id,
    version: 2,
    parent_comment_id: null,
    author_id: admin?.id ?? owner.id,
    body: "Change the text colour to red here — it's fighting the background.",
    t_start_seconds: 14,
    t_end_seconds: null,
    mentions: [],
    resolved: false,
    visibility: "internal",
    assignee_id: ed1?.id ?? null,
    drawing,
    voice_path: null,
    voice_duration_seconds: null,
    voice_peaks: null,
    attachments: [],
  });

  // --- voice note -----------------------------------------------------------
  const seconds = 4;
  const voicePath = await upload(
    `${owner.id}/demo-voice-note.wav`,
    speechLikeWav(seconds),
    "audio/wav"
  );
  const notePath = await upload(
    `${owner.id}/demo-colour-reference.txt`,
    Buffer.from(
      "Brand colour reference\n\nPrimary  #7C5CFF\nAccent   #F4515F\nText     #EDEDF2\n",
      "utf8"
    ),
    "text/plain"
  );

  await db.from("cut_comments").delete().eq("cut_id", mainCut.id).eq("voice_path", voicePath);
  await db.from("cut_comments").insert({
    cut_id: mainCut.id,
    version: 2,
    parent_comment_id: null,
    author_id: owner.id,
    body: "",
    t_start_seconds: 22,
    t_end_seconds: null,
    mentions: [],
    resolved: false,
    visibility: "internal",
    assignee_id: null,
    drawing: null,
    voice_path: voicePath,
    voice_duration_seconds: seconds,
    voice_peaks: speechLikePeaks(seconds),
    attachments: [],
  });

  // --- comment with an attachment ------------------------------------------
  await db
    .from("cut_comments")
    .delete()
    .eq("cut_id", mainCut.id)
    .eq("body", "Palette for the lower third — swatches attached.");
  await db.from("cut_comments").insert({
    cut_id: mainCut.id,
    version: 2,
    parent_comment_id: null,
    author_id: owner.id,
    body: "Palette for the lower third — swatches attached.",
    t_start_seconds: 8,
    t_end_seconds: null,
    mentions: [],
    resolved: false,
    visibility: "client",
    assignee_id: null,
    drawing: null,
    voice_path: null,
    voice_duration_seconds: null,
    voice_peaks: null,
    attachments: [
      { path: notePath, name: "colour-reference.txt", size: 96, type: "text/plain" },
    ],
  });

  // --- transcript -----------------------------------------------------------
  const cues = [
    [0.4, 3.1, "The first two seconds decide the whole video."],
    [3.1, 6.4, "And after a few hundred cuts, the pattern gets so familiar"],
    [6.4, 10.2, "that you stop noticing what is actually carrying the hook."],
    [10.2, 13.8, "That is the moment the whole thing quietly stops working."],
    [13.8, 17.5, "So we rebuilt the entire process around that one idea."],
    [17.5, 21.9, "Every cut now starts from the hook and works outwards."],
    [21.9, 26.0, "The brief, the script and the edit all point at the same beat."],
    [26.0, 29.9, "That one change did more than any tool we tried."],
  ].map(([start, end, text]) => ({ start, end, text }));

  await db.from("cut_transcripts").upsert(
    {
      cut_id: mainCut.id,
      version: 2,
      language: "en",
      cues,
      source: "manual",
      created_by: owner.id,
    },
    { onConflict: "cut_id,version,language" }
  );

  // --- board drag order -----------------------------------------------------
  // Give the in-flight columns an explicit hand-placed order so the drag
  // affordance has something to reorder against.
  const { data: actives } = await db
    .from("videos")
    .select("id, status")
    .neq("status", "posted")
    .order("priority_rank", { ascending: false })
    .order("created_at");
  const seen = {};
  for (const v of actives ?? []) {
    seen[v.status] = (seen[v.status] ?? 0) + 1;
    await db.from("videos").update({ board_position: seen[v.status] * 1024 }).eq("id", v.id);
  }

  const { count: msgs } = await db
    .from("video_messages")
    .select("*", { count: "exact", head: true })
    .eq("video_id", hero.id);

  console.log("✓ workspace demo seeded");
  console.log(`  drawing + voice note + attachment on “${hero.title}”`);
  console.log(`  transcript: ${cues.length} cues`);
  console.log(`  board_position set on ${actives?.length ?? 0} videos`);
  console.log(`  chat messages on hero video: ${msgs ?? 0}`);
};

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
