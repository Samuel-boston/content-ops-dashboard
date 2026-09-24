// npx tsx scripts/test-top-posts-parse.mts
import assert from "node:assert/strict";
import { parsePastedPosts, parseViews, platformOf } from "../src/lib/top-posts-parse.ts";

assert.equal(parseViews("1.2M"), 1_200_000);
assert.equal(parseViews("350k"), 350_000);
assert.equal(parseViews("12,400 views"), 12_400);
assert.equal(parseViews(880), 880);
assert.equal(parseViews("lots"), null);
assert.equal(platformOf("https://www.instagram.com/reel/abc/"), "instagram");
assert.equal(platformOf("https://youtu.be/xyz"), "youtube");
assert.equal(platformOf("https://x.com/a/status/1"), "x");

// header table (what a spreadsheet or an AI table gives you)
const table = `Views | Topic | Hook | Link
1.2M | Burnout signs | Nobody tells you this about burnout | https://www.instagram.com/reel/aaa/
350k | Morning routine | I stopped doing this at 6am | https://www.tiktok.com/@a/video/1`;
const t = parsePastedPosts(table);
assert.equal(t.length, 2);
assert.equal(t[0].views, 1_200_000); assert.equal(t[0].topic, "Burnout signs");
assert.equal(t[0].hook, "Nobody tells you this about burnout"); assert.equal(t[0].platform, "instagram");
assert.equal(t[1].platform, "tiktok");

// CSV with a header and different column order
const csv = `topic,views,url,notes\n"Airport anxiety",90000,https://youtube.com/shorts/q,"calm voiceover"`;
const c = parsePastedPosts(csv)[0];
assert.equal(c.topic, "Airport anxiety"); assert.equal(c.views, 90_000); assert.equal(c.platform, "youtube"); assert.equal(c.notes, "calm voiceover");

// loose lines: link and views picked out anywhere
const loose = parsePastedPosts(`- 2.4M views - Why sleep matters - "Stop scrolling before bed" https://www.instagram.com/reel/zzz\n1. Grounding trick | 40K | https://www.tiktok.com/@x/video/9`);
assert.equal(loose.length, 2);
assert.equal(loose[0].views, 2_400_000); assert.ok(loose[0].topic.includes("sleep")); assert.ok(loose[0].link!.includes("zzz"));
assert.equal(loose[1].views, 40_000); assert.equal(loose[1].topic, "Grounding trick");

// JSON from an AI
const j = parsePastedPosts(`[{"topic":"Grief and work","hook":"You don't get bereavement leave for this","views":"820K","link":"https://youtu.be/a","creator":"@coach","source":"own"}]`);
assert.equal(j[0].views, 820_000); assert.equal(j[0].source, "own"); assert.equal(j[0].creator, "@coach");

// empty / junk
assert.deepEqual(parsePastedPosts("   "), []);
assert.equal(parsePastedPosts("Just a topic with no numbers")[0].topic, "Just a topic with no numbers");
console.log("top posts parse: all checks passed");
