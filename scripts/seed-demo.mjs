#!/usr/bin/env node
/**
 * Seed realistic PLACEHOLDER content so the dashboard demonstrates itself.
 * Everything here is example data — safe to wipe before the client hand-off.
 *
 *   node scripts/seed-demo.mjs          # add demo content
 *   node scripts/seed-demo.mjs --reset  # wipe demo content first
 *
 * Playback uses Cloudflare's public Stream demo asset so the video engine
 * (scrubbing, pinned comments, version compare) is fully explorable before
 * real Cloudflare credentials are added in Settings → Integrations.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const DEMO_HLS =
  "https://customer-f33zs165nr7gyfy4.cloudflarestream.com/6b9e68b07dfee8cc2d116e4c51d6a957/manifest/video.m3u8";
const DEMO_THUMB =
  "https://customer-f33zs165nr7gyfy4.cloudflarestream.com/6b9e68b07dfee8cc2d116e4c51d6a957/thumbnails/thumbnail.jpg";

const day = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const ago = (n) => new Date(Date.now() - n * 864e5).toISOString();

async function main() {
  const reset = process.argv.includes("--reset");

  const { data: profiles } = await db.from("profiles").select("id, email, role");
  const owner = profiles.find((p) => p.role === "owner");
  const admin = profiles.find((p) => p.email === "admin@example.com");
  const ed1 = profiles.find((p) => p.email === "editor1@example.com");
  const ed2 = profiles.find((p) => p.email === "editor2@example.com");
  if (!owner) throw new Error("Run scripts/seed.mjs first — no owner found.");

  if (reset) {
    console.log("• wiping existing videos + library content");
    await db.from("videos").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await db.from("music_tracks").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await db.from("reference_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await db.from("sop_docs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await db.from("notifications").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  }

  // ---------------------------------------------------------------- videos
  const base = {
    status: "ready_to_edit",
    priority: "standard",
    content_pillars: [],
    formats: [],
    platforms: [],
    script_hooks: [],
    needs_script: false,
    post_date: null,
    posted_at: null,
    assigned_editor_id: null,
    frameio_url: null,
    brief: null,
    script_body: null,
    script_cta: null,
    raw_footage_url: null,
    drive_file_url: null,
    created_by: owner.id,
  };

  const videos = [
    {
      title: "Client testimonial — Q3 launch",
      priority: "urgent",
      status: "in_review",
      assigned_editor_id: ed1?.id,
      platforms: ["Instagram"],
      formats: ["Talking head"],
      content_pillars: ["Promotion"],
      brief: "Warm intro, punchy. Keep the first 3 seconds tight — we lose people otherwise.",
      script_hooks: [
        "Nobody tells you this before you quit your 9-to-5…",
        "I lost $40k before I figured this out.",
      ],
      script_body:
        "Open on the client testimonial clip.\n\nCut to the result — the number on screen, held for a beat.\n\nThen the mechanism: what we actually changed, in three steps.\n\nClose on the invitation.",
      script_cta: "Link in bio to book a free call.",
      post_date: day(4),
    },
    {
      title: "Founder story, part 2",
      priority: "high",
      platforms: ["Instagram"],
      formats: ["Long video"],
      content_pillars: ["Personality", "Belief Creation"],
      brief: "Picks up where part 1 left off — the year everything nearly went under.",
    },
    {
      title: "Objection: “it's too expensive”",
      priority: "high",
      platforms: ["Instagram"],
      formats: ["Green screen"],
      content_pillars: ["Objection Handling"],
      brief: "Reframe price as cost-of-inaction. Green screen over the pricing page.",
    },
    {
      title: "Cold outreach template #14",
      platforms: ["Instagram", "TikTok"],
      formats: ["Short video"],
      content_pillars: ["Value"],
    },
    {
      title: "Behind the scenes — office",
      platforms: ["IG Story"],
      formats: ["Silent film"],
      content_pillars: ["Personality"],
    },
    {
      title: "Whiteboard: the 3-step funnel",
      platforms: ["Instagram"],
      formats: ["Whiteboard"],
      content_pillars: ["Top of funnel"],
      needs_script: true,
      brief: "(from voice note) Walk the whiteboard left to right, one marker colour per step.",
    },
    {
      title: "Why most reels stop converting at 3s",
      priority: "urgent",
      platforms: ["Instagram"],
      formats: ["Talking head"],
      content_pillars: ["Belief Breaking", "Viral"],
      brief: "Hook-rate teardown. Show the retention graph on screen.",
    },
    {
      title: "Career transition — the 90 day plan",
      status: "in_progress",
      assigned_editor_id: ed2?.id,
      priority: "high",
      platforms: ["Instagram"],
      formats: ["Split screen carousel"],
      content_pillars: ["Career Transition"],
    },
    {
      title: "Day in the life — shoot day",
      status: "in_progress",
      assigned_editor_id: ed1?.id,
      platforms: ["IG Story"],
      formats: ["Silent film"],
      content_pillars: ["Personality"],
    },
    {
      title: "The thread that got 2M views, explained",
      status: "revisions",
      assigned_editor_id: ed2?.id,
      priority: "high",
      platforms: ["Instagram"],
      formats: ["Carousel with text"],
      content_pillars: ["Thread", "Viral"],
      brief: "Second pass — pacing was too slow through the middle.",
    },
    {
      title: "Testimonial carousel — Q3",
      status: "approved",
      assigned_editor_id: ed1?.id,
      priority: "high",
      platforms: ["Instagram"],
      formats: ["Carousel with text"],
      content_pillars: ["Promotion"],
      post_date: day(3),
    },
    {
      title: "5 things I'd tell my younger self",
      status: "approved",
      assigned_editor_id: ed2?.id,
      platforms: ["Instagram"],
      formats: ["Talking head"],
      content_pillars: ["Value", "Personality"],
      post_date: day(6),
    },
    {
      title: "July recap reel",
      status: "posted",
      assigned_editor_id: ed1?.id,
      platforms: ["Instagram"],
      formats: ["Short video"],
      content_pillars: ["Viral"],
      post_date: day(-6),
      posted_at: ago(6),
    },
    {
      title: "Client win — 3x in 60 days",
      status: "posted",
      assigned_editor_id: ed2?.id,
      platforms: ["Instagram"],
      formats: ["Talking head"],
      content_pillars: ["Promotion"],
      post_date: day(-13),
      posted_at: ago(13),
    },
    {
      title: "Silent film: the morning routine",
      status: "posted",
      assigned_editor_id: ed1?.id,
      platforms: ["Instagram"],
      formats: ["Silent film"],
      content_pillars: ["Personality"],
      post_date: day(-20),
      posted_at: ago(20),
    },
  ].map((v) => ({ ...base, ...v }));

  const { data: existing } = await db.from("videos").select("id, title");
  const have = new Set((existing ?? []).map((v) => v.title));
  const toInsert = videos.filter((v) => !have.has(v.title));
  if (toInsert.length) {
    const { error } = await db.from("videos").insert(toInsert);
    if (error) throw error;
  }
  console.log(`✓ videos: ${toInsert.length} added (${videos.length} in the demo set)`);

  const { data: all } = await db.from("videos").select("id, title, status, assigned_editor_id");
  const byTitle = Object.fromEntries(all.map((v) => [v.title, v]));

  // Make one video visibly stalled so "Needs attention" has something in it.
  const stale = byTitle["The thread that got 2M views, explained"];
  if (stale) await db.from("videos").update({ stage_entered_at: ago(9) }).eq("id", stale.id);

  // ------------------------------------------------- cuts, versions, comments
  const hero = byTitle["Client testimonial — Q3 launch"];
  if (hero) {
    const { data: mainCut } = await db
      .from("video_cuts")
      .select("id")
      .eq("video_id", hero.id)
      .eq("kind", "main")
      .single();

    const { count: vCount } = await db
      .from("cut_versions")
      .select("*", { count: "exact", head: true })
      .eq("cut_id", mainCut.id);

    if (!vCount) {
      await db.from("cut_versions").insert([
        {
          cut_id: mainCut.id,
          version: 1,
          stream_uid: "demo-6b9e68b07dfee8cc2d116e4c51d6a957",
          status: "ready",
          duration_seconds: 30,
          thumbnail_url: DEMO_THUMB,
          playback_url: DEMO_HLS,
          uploaded_by: ed1?.id ?? owner.id,
          created_at: ago(4),
        },
        {
          cut_id: mainCut.id,
          version: 2,
          stream_uid: "demo-6b9e68b07dfee8cc2d116e4c51d6a957",
          status: "ready",
          duration_seconds: 30,
          thumbnail_url: DEMO_THUMB,
          playback_url: DEMO_HLS,
          uploaded_by: ed1?.id ?? owner.id,
          created_at: ago(1),
        },
      ]);

      // NOTE: PostgREST sends NULL (not DEFAULT) for a key that's missing from
      // SOME rows of a multi-row insert — so every row spells out every column.
      const comment = (over) => ({
        cut_id: mainCut.id,
        version: 2,
        parent_comment_id: null,
        author_id: owner.id,
        body: "",
        t_start_seconds: null,
        t_end_seconds: null,
        mentions: [],
        resolved: false,
        ...over,
      });
      const { error: ccErr } = await db.from("cut_comments").insert([
        comment({
          body: "Hold this beat half a second longer — it lands better.",
          t_start_seconds: 4.2,
        }),
        comment({
          author_id: admin?.id ?? owner.id,
          body: "This whole stretch feels slow. Tighten the middle.",
          t_start_seconds: 11,
          t_end_seconds: 17.5,
        }),
        comment({
          body: "Captions are drifting out of the safe area here.",
          t_start_seconds: 23.4,
          resolved: true,
        }),
        comment({ body: "Overall this is close. Two notes above and it ships." }),
      ]);
      if (ccErr) throw ccErr;

      // A hook variant, with its own cut + version.
      const { data: hook } = await db
        .from("video_cuts")
        .insert({
          video_id: hero.id,
          kind: "hook",
          label: "Warm + fast",
          notes: "Warmer grade, first 3s sped up 15% to hit the hook quicker, no music bed.",
          position: 1,
          created_by: ed1?.id ?? owner.id,
        })
        .select("id")
        .single();

      await db.from("cut_versions").insert({
        cut_id: hook.id,
        version: 1,
        stream_uid: "demo-6b9e68b07dfee8cc2d116e4c51d6a957",
        status: "ready",
        duration_seconds: 30,
        thumbnail_url: DEMO_THUMB,
        playback_url: DEMO_HLS,
        uploaded_by: ed1?.id ?? owner.id,
      });

      await db.from("cut_comments").insert({
        cut_id: hook.id,
        version: 1,
        author_id: owner.id,
        body: "Much better open. Let's run this one as the A test.",
        t_start_seconds: 1.8,
      });

      // Durations match the demo asset so the pins land where they should.
      await db.from("cut_versions").update({ duration_seconds: 30 }).eq("cut_id", mainCut.id);
      await db.from("cut_versions").update({ duration_seconds: 30 }).eq("cut_id", hook.id);
    }

    // chat
    const { count: msgCount } = await db
      .from("video_messages")
      .select("*", { count: "exact", head: true })
      .eq("video_id", hero.id);
    if (!msgCount) {
      const msg = (over) => ({
        video_id: hero.id,
        author_id: owner.id,
        body: "",
        mentions: [],
        created_at: ago(2),
        ...over,
      });
      const { error: msgErr } = await db.from("video_messages").insert([
        msg({
          body: "Can we try the faster pacing from the last one? @PlaceholderEditorOne",
          mentions: ed1 ? [ed1.id] : [],
        }),
        msg({
          author_id: ed1?.id ?? owner.id,
          body: "On it — uploading as a hook variant so we keep the original too.",
        }),
        msg({
          author_id: admin?.id ?? owner.id,
          body: "Variant looks good to me. One note pinned at 11s.",
          created_at: ago(1),
        }),
      ]);
      if (msgErr) throw msgErr;
    }
  }

  // ----------------------------------------------------------- music library
  const { count: musicCount } = await db
    .from("music_tracks")
    .select("*", { count: "exact", head: true });
  if (!musicCount) {
    const cats = {
      "Upbeat / Energetic": ["Morning Drive", "Neon Pulse", "Quick Cuts", "Sunrise Sprint", "Hard Cut"],
      "Cinematic / Moody": ["Low Light", "Slow Burn", "Long Shadow", "The Turn"],
      "Lo-fi / Background": ["Soft Focus", "Paper Trail", "Window Seat", "Second Coffee", "Late Desk"],
      "Corporate / Clean": ["Clear Brief", "Boardroom", "Straight Line"],
      Uncategorized: ["Telegram upload 04-12", "Untitled bounce v3"],
    };
    const rows = [];
    for (const [category, titles] of Object.entries(cats)) {
      for (const title of titles) {
        rows.push({
          title,
          category,
          // No binary in the demo set — the row shows how the library reads.
          storage_path: `demo/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.mp3`,
          duration_seconds: 60 + Math.floor(Math.random() * 160),
          uploaded_by: owner.id,
        });
      }
    }
    await db.from("music_tracks").insert(rows);
    console.log(`✓ music: ${rows.length} tracks across ${Object.keys(cats).length} categories`);
  }

  // -------------------------------------------------------------- references
  const { count: refCount } = await db
    .from("reference_items")
    .select("*", { count: "exact", head: true });
  if (!refCount) {
    await db.from("reference_items").insert([
      {
        kind: "link",
        url: "https://www.instagram.com/reel/example-hook-reference/",
        note: "Hook structure we want to copy — first 2 seconds.",
        added_by: owner.id,
      },
      {
        kind: "link",
        url: "https://www.tiktok.com/@example/video/1234567890",
        note: "Caption placement here is really clean.",
        added_by: owner.id,
      },
      {
        kind: "link",
        url: "https://www.youtube.com/watch?v=example",
        note: "Pacing reference for the long-form cut.",
        status: "used",
        added_by: admin?.id ?? owner.id,
      },
      ...(hero
        ? [
            {
              video_id: hero.id,
              kind: "link",
              url: "https://www.instagram.com/p/example-grade-ref/",
              note: "Grade reference for this one specifically.",
              added_by: owner.id,
            },
          ]
        : []),
    ]);
    console.log("✓ references seeded");
  }

  // --------------------------------------------------------------- SOP docs
  const { count: sopCount } = await db.from("sop_docs").select("*", { count: "exact", head: true });
  if (!sopCount) {
    await db.from("sop_docs").insert([
      {
        title: "House style — everything",
        format: null,
        position: 0,
        updated_by: owner.id,
        body: `# House style

The rules that apply to every cut, whatever the format.

## Non-negotiables
- **First 3 seconds carry the video.** If the hook isn't landing by 0:03, recut it.
- Captions are burned in, always. Never rely on platform auto-captions.
- Keep everything inside the safe area — nothing important in the bottom 15%.
- Audio ducks under speech. Music never competes with a voice.

## Pacing
1. Cut on the beat where you can, on the breath where you can't.
2. No shot longer than ~4 seconds unless it's earning it.
3. When in doubt, cut it tighter. We can always add a frame back.

> If a section feels slow to you on the third watch, it felt slow to the viewer on the first.

## Delivery
- Upload the cut here, not to Drive. Raw footage goes in the Raw footage panel.
- Tag the Content Pillar, Format and Platform before you move it to In Review.`,
      },
      {
        title: "Talking head",
        format: "Talking head",
        position: 1,
        updated_by: owner.id,
        body: `# Talking head

## Setup
- Eye-line just above lens. Framing: eyes on the upper third.
- Cut the pauses — every "um" and every breath between thoughts.

## What good looks like
- A jump cut roughly every 2–4 seconds.
- B-roll or a graphic whenever a number or a claim is spoken.
- The CTA is on screen as text, not just spoken.`,
      },
      {
        title: "Green screen",
        format: "Green screen",
        position: 2,
        updated_by: owner.id,
        body: `# Green screen

- Key needs to hold on hair — check the edges at 100% before you export.
- Background asset stays legible: if it's a screenshot, zoom to the part that matters.
- Subject sits on the left third, background content on the right.`,
      },
    ]);
    console.log("✓ SOP docs seeded");
  }

  // ----------------------------------------------------------------- metrics
  const posted = all.filter((v) => v.status === "posted");
  for (const [i, v] of posted.entries()) {
    const { data: exists } = await db
      .from("video_metrics")
      .select("id")
      .eq("video_id", v.id)
      .maybeSingle();
    if (exists) continue;
    const reach = 18000 + i * 9000 + Math.floor(Math.random() * 12000);
    await db.from("video_metrics").insert({
      video_id: v.id,
      source: "instagram",
      external_media_id: `demo_media_${i + 1}`,
      permalink: "https://www.instagram.com/reel/demo/",
      views: Math.round(reach * 1.4),
      reach,
      likes: Math.round(reach * 0.06),
      comments: Math.round(reach * 0.004),
      shares: Math.round(reach * 0.011),
      saves: Math.round(reach * 0.018),
    });
  }
  console.log(`✓ metrics on ${posted.length} posted videos`);

  // ----------------------------------------------------------- notifications
  const { count: nCount } = await db
    .from("notifications")
    .select("*", { count: "exact", head: true });
  if (!nCount && ed1) {
    await db.from("notifications").insert([
      {
        user_id: ed1.id,
        kind: "assignment",
        title: "You've been assigned “Client testimonial — Q3 launch”",
        link: `/videos/${hero?.id ?? ""}`,
        video_id: hero?.id ?? null,
        created_at: ago(3),
      },
      {
        user_id: ed1.id,
        kind: "mention",
        title: "Owner mentioned you in “Client testimonial — Q3 launch”",
        body: "Can we try the faster pacing from the last one?",
        link: `/videos/${hero?.id ?? ""}`,
        video_id: hero?.id ?? null,
        created_at: ago(2),
      },
      {
        user_id: owner.id,
        kind: "stalled",
        title: "Stalled: “The thread that got 2M views, explained”",
        body: "9 days in Revisions.",
        link: `/videos/${stale?.id ?? ""}`,
        video_id: stale?.id ?? null,
        created_at: ago(1),
      },
    ]);
    console.log("✓ notifications seeded");
  }

  console.log("\nDemo content ready.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
