#!/usr/bin/env node
// Seed the b-roll library with the folder names from the client's Google Drive.
//
// Names only — no share links. Those get pasted in from the dashboard once
// somebody has the Drive open, and the UI shows which ones are still missing.
//
//   node scripts/seed-broll.mjs

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

/**
 * Read off the two screenshots of the client's Drive, in the order they
 * appeared. Truncated names ("Adam kid: 10yr old and…") are recorded as shown
 * minus the ellipsis — they're editable in the dashboard.
 */
const CATEGORIES = [
  // Subjects and people
  "01_Talking Head",
  "Interviews",
  "Podcast / Interviews",
  "Testimonials",
  "Keynote Speaking",
  "Coaching calls",
  "Meet Recordings",
  "Journal",
  "Home/reflective",
  "Family/Personal Journey",
  "relationship",
  "Bachelor",
  "Men group shots",
  "Adam kid: 10yr old and under",
  "Adam Kunder: Till Lies Do Us Part",
  "Kunder Landscape Company",

  // Activities
  "Gym/Training",
  "Ice baths / Cold exposure",
  "Sauna",
  "Breathwork/sitting/meditation",
  "Firefighting",
  "Skydiving",
  "Driving",
  "Flights",
  "Eating",
  "Drinking Coffee",
  "Drinking alcohol",
  "At desk working, on bed",
  "Acting / Modelling",

  // Moods and looks
  "Visually Upset",
  "Silent Story Telling shots",
  "Night Time Shots",
  "Nature / Outdoor",
  "Travel/Lifestyle",
  "Partying / Nightlife / Social",

  // Events and shoots
  "Events / Workshops",
  "Event: Reset June 5th, 2026",
  "R1 workshop March 30th",
  "Book Launch",
  "Birthday",
  "Mexico Trip 2026",
  "June 13th night shots 2026",
  "July Videos",
  "B-Roll June/July",
  "video b-roll Nathan",

  // Outputs
  "Carousel Photos",
  "YTLF VIDEOS",
  "Intro Videos Finished",
  "Final cut videos",
  "Top Picks",
];

const rows = CATEGORIES.map((name, i) => ({ name, position: i }));

const res = await fetch(`${url}/rest/v1/broll_categories`, {
  method: "POST",
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    // Re-runnable: an existing category keeps whatever share link it has.
    Prefer: "return=representation,resolution=ignore-duplicates",
  },
  body: JSON.stringify(rows),
});

const body = await res.json();
if (!res.ok) {
  console.error("✗ failed", res.status, JSON.stringify(body));
  process.exit(1);
}
console.log(`✓ ${Array.isArray(body) ? body.length : 0} categories inserted (${CATEGORIES.length} in the list)`);
