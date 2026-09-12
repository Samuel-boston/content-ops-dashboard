#!/usr/bin/env node
// Demo content for the extended pipeline: ideation and scripting ideas, ETAs on
// in-flight work, per-editor rates, and a couple of priced/posted videos so the
// Team month view has something in it. Idempotent.
//
//   node scripts/seed-pipeline-demo.mjs

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const IDEAS = [
  {
    title: "Why nobody watches your second video",
    brief: "Retention drops off a cliff after the first post. Explain why.",
    content_pillars: ["Belief Breaking"],
    formats: ["Short video"],
    platforms: ["Instagram"],
  },
  {
    title: "The 3-tool stack I'd start with today",
    brief: "Simple, cheap, opinionated. No affiliate nonsense.",
    content_pillars: ["Value"],
    formats: ["Talking head"],
    platforms: ["Instagram", "TikTok"],
  },
  {
    title: "What I'd charge if I started over",
    brief: "Pricing story. Personal, a bit vulnerable.",
    content_pillars: ["Personality"],
    formats: ["Talking head"],
    platforms: ["Instagram"],
  },
];

const SCRIPTS = [
  {
    title: "Stop editing like it's 2019",
    brief: "Punchy. The old jump-cut style is actively hurting retention now.",
    content_pillars: ["Belief Breaking"],
    formats: ["Short video"],
    platforms: ["Instagram", "TikTok"],
    // More than one hook => hook variants expected after approval.
    script_hooks: [
      "Your edit style is three years out of date.",
      "Jump cuts stopped working and nobody told you.",
      "This edit trick is quietly killing your retention.",
    ],
    script_body:
      "Open on the timeline. Show the old style: cut, cut, cut, zoom.\n\n" +
      "Then the change — hold the shot. Let one idea land before moving.\n\n" +
      "Show the retention graph side by side.",
    script_cta: "Try it on one video this week and tell me what happened.",
  },
  {
    title: "The one-line brief that fixed our turnaround",
    brief: "Ops story — how a shorter brief made everything faster.",
    content_pillars: ["Value", "Career Transition"],
    formats: ["Talking head"],
    platforms: ["Instagram"],
    // Single hook => no variants.
    script_hooks: ["We deleted 90% of our brief template and got faster."],
    script_body:
      "The old brief was a page. Nobody read it.\n\n" +
      "Now it's one line: what has to be true for this video to work?\n\n" +
      "Turnaround halved.",
    script_cta: "Steal the one-liner — it's in the caption.",
  },
];

const main = async () => {
  const { data: people } = await db.from("profiles").select("id, email, role");
  const owner = people.find((p) => p.role === "owner");
  const editors = people.filter((p) => p.role === "editor");
  if (!owner) throw new Error("No owner — run scripts/seed.mjs first.");

  const upsertVideo = async (row, status) => {
    const { data: existing } = await db
      .from("videos")
      .select("id")
      .eq("title", row.title)
      .maybeSingle();
    if (existing) return existing.id;
    const { data, error } = await db
      .from("videos")
      .insert({ ...row, status, needs_script: status !== "scripting", created_by: owner.id })
      .select("id")
      .single();
    if (error) throw new Error(`${row.title}: ${error.message}`);
    return data.id;
  };

  let added = 0;
  for (const idea of IDEAS) {
    await upsertVideo(idea, "ideation");
    added += 1;
  }
  for (const s of SCRIPTS) {
    await upsertVideo({ ...s, needs_script: false }, "scripting");
    added += 1;
  }

  // --- ETAs on work that's actually being edited -----------------------------
  const { data: inFlight } = await db
    .from("videos")
    .select("id, status, assigned_editor_id, eta_at")
    .in("status", ["in_progress", "revisions", "awaiting_variants"])
    .not("assigned_editor_id", "is", null);

  let etas = 0;
  for (const [i, v] of (inFlight ?? []).entries()) {
    if (v.eta_at) continue;
    const d = new Date();
    // Spread them out, and let one land in the past so "overdue" is visible.
    d.setDate(d.getDate() + (i === 0 ? -1 : i + 1));
    d.setHours(18, 0, 0, 0);
    await db
      .from("videos")
      .update({
        eta_at: d.toISOString(),
        eta_stage: v.status,
        eta_set_by: v.assigned_editor_id,
        eta_set_at: new Date().toISOString(),
      })
      .eq("id", v.id);
    etas += 1;
  }

  // --- Rates ----------------------------------------------------------------
  const RATES = {
    "Short video": 3000,
    "Long video": 7500,
    "Talking head": 3000,
    "Green screen": 3500,
    "Whiteboard": 4500,
    "Carousel with text": 2000,
    Image: 1200,
  };
  let rateRows = 0;
  for (const ed of editors) {
    for (const [format, price_cents] of Object.entries(RATES)) {
      const { error } = await db
        .from("editor_rates")
        .upsert(
          { editor_id: ed.id, format, price_cents, updated_by: owner.id },
          { onConflict: "editor_id,format" }
        );
      if (!error) rateRows += 1;
    }
  }

  // --- Price the already-posted videos so Team has a month to show -----------
  const { data: posted } = await db
    .from("videos")
    .select("id, price_cents, assigned_editor_id, posted_at")
    .eq("status", "posted");

  let priced = 0;
  for (const v of posted ?? []) {
    if (v.price_cents != null || !v.assigned_editor_id) continue;
    const { data: breakdown } = await db.rpc("video_price", { p_video_id: v.id });
    if (!breakdown) continue;
    await db
      .from("videos")
      .update({
        price_cents: breakdown.total_cents,
        price_breakdown: breakdown,
        priced_at: new Date().toISOString(),
        // Pull undated posts into this month so the default view isn't empty.
        posted_at: v.posted_at ?? new Date().toISOString(),
      })
      .eq("id", v.id);
    priced += 1;
  }

  console.log("✓ pipeline demo seeded");
  console.log(`  ideas + scripts ensured: ${added}`);
  console.log(`  ETAs set: ${etas}`);
  console.log(`  rate rows: ${rateRows} (${editors.length} editors)`);
  console.log(`  posted videos priced: ${priced}`);
};

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
