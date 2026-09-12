#!/usr/bin/env node
// Fill out editor1's task board with a realistic, busy spread across every
// bucket (revisions, first cut owed, still editing, hook variants at every
// aging tier) so the "My Work" view can be eyeballed with more than one row
// in it. Demo data only — idempotent by title.
//
//   node scripts/seed-task-demo.mjs

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const hoursFromNow = (n) => new Date(Date.now() + n * 36e5).toISOString();

const main = async () => {
  const { data: people } = await db.from("profiles").select("id, email, role");
  const owner = people.find((p) => p.role === "owner");
  const editor1 = people.find((p) => p.email === "editor1@example.com");
  if (!owner || !editor1) throw new Error("Run scripts/seed.mjs (with SEED_PLACEHOLDERS=1) first.");

  const ROWS = [
    // -- Needs revisions --------------------------------------------------
    {
      title: "Client testimonial — B-roll pass",
      status: "revisions",
      formats: ["Talking head"],
      priority: "high",
      etaHoursFromNow: -18, // overdue
      stageDaysAgo: 1,
    },
    {
      title: "Product unboxing — trim intro",
      status: "revisions",
      formats: ["Short video"],
      priority: "standard",
      etaHoursFromNow: 30, // due tomorrow evening
      stageDaysAgo: 0,
    },
    // -- Needs a first cut (claimed, nothing uploaded) --------------------
    {
      title: "Founder Q&A — September",
      status: "in_progress",
      formats: ["Talking head"],
      priority: "urgent",
      etaHoursFromNow: -6, // overdue
      stageDaysAgo: 2,
      withCut: false,
    },
    {
      title: "Behind the scenes — studio setup",
      status: "in_progress",
      formats: ["Short video"],
      priority: "standard",
      etaHoursFromNow: 48,
      stageDaysAgo: 0,
      withCut: false,
    },
    // -- Still editing (draft already uploaded) ---------------------------
    {
      title: "Weekly recap — episode 12",
      status: "in_progress",
      formats: ["Long video"],
      priority: "standard",
      etaHoursFromNow: 20,
      stageDaysAgo: 1,
      withCut: true,
    },
    // -- Needs hook variants (aging tiers: subtle / warn / danger) --------
    {
      title: "5 tools I can't work without",
      status: "awaiting_variants",
      formats: ["Short video"],
      priority: "standard",
      stageDaysAgo: 0, // subtle — approved today
    },
    {
      title: "Why your first video always flops",
      status: "awaiting_variants",
      formats: ["Short video"],
      priority: "standard",
      stageDaysAgo: 2, // warn
    },
    {
      title: "The pricing mistake I made for years",
      status: "awaiting_variants",
      formats: ["Talking head"],
      priority: "high",
      stageDaysAgo: 5, // danger — past the stalled threshold
    },
  ];

  let created = 0;
  let skipped = 0;
  for (const row of ROWS) {
    const { data: existing } = await db.from("videos").select("id").eq("title", row.title).maybeSingle();
    if (existing) {
      skipped += 1;
      continue;
    }

    const { data: video, error } = await db
      .from("videos")
      .insert({
        title: row.title,
        status: row.status,
        formats: row.formats,
        priority: row.priority,
        assigned_editor_id: editor1.id,
        needs_script: false,
        script_hooks: ["A hook that actually stops the scroll."],
        script_body: "Demo script body for task-board sample data.",
        script_cta: "Follow for more.",
        created_by: owner.id,
      })
      .select("id")
      .single();
    if (error) throw new Error(`${row.title}: ${error.message}`);

    // Backdate stage_entered_at (the insert trigger stamps "now") so aging
    // and overdue states actually show up instead of everything reading "today".
    await db
      .from("videos")
      .update({ stage_entered_at: daysAgo(row.stageDaysAgo) })
      .eq("id", video.id);

    if (row.etaHoursFromNow !== undefined) {
      await db
        .from("videos")
        .update({
          eta_at: hoursFromNow(row.etaHoursFromNow),
          eta_stage: row.status,
          eta_set_by: editor1.id,
          eta_set_at: daysAgo(row.stageDaysAgo),
        })
        .eq("id", video.id);
    }

    if (row.withCut) {
      const { data: cut } = await db
        .from("video_cuts")
        .select("id")
        .eq("video_id", video.id)
        .eq("kind", "main")
        .single();
      await db.from("cut_versions").insert({
        cut_id: cut.id,
        version: 1,
        status: "ready",
        uploaded_by: editor1.id,
      });
    }

    created += 1;
  }

  console.log(`✓ task-board demo seeded for editor1@example.com`);
  console.log(`  created: ${created}, already existed (skipped): ${skipped}`);
};

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
