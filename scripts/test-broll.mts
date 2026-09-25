// Exercises the B-roll section's pure logic: transcript parsing and beats, reranking, and exports.
//   npx tsx scripts/test-broll.mts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { folderName, NO_CATEGORY } from "../src/lib/broll.ts";
import { beatsFromText, parseSrt, parseVtt, parseTranscript, clock } from "../src/lib/broll-transcript.ts";
import { orderCandidates, readRerank, rerankUserPrompt, REPEAT_PENALTY } from "../src/lib/broll-match.ts";
import { buildTimeline, csv, edl, fcp7Xml, timecode, ntscTimebase, type ExportBeat, type ExportShot } from "../src/lib/broll-export.ts";

// ---- folders
assert.equal(folderName("04_Daily Rituals"), "Daily Rituals");
assert.equal(folderName("Daily Rituals"), "Daily Rituals");
assert.equal(folderName("12 - Life Chapters"), "Life Chapters");
assert.equal(folderName("07_"), "07_");
assert.equal(NO_CATEGORY, "__none");

// ---- SRT, VTT, plain
const srt = `1\n00:00:01,000 --> 00:00:04,500\nI woke up at five every morning.\n\n2\n00:00:04,500 --> 00:00:09,000\n<i>ADAM:</i> Then I sat by the sea and breathed.\n\n3\n00:00:09,000 --> 00:00:10,000\nStill.`;
const cues = parseSrt(srt);
assert.equal(cues.length, 3);
assert.equal(cues[0].startS, 1);
assert.equal(cues[1].text, "Then I sat by the sea and breathed.");
assert.equal(parseTranscript(srt).estimated, false);
assert.equal(parseVtt("WEBVTT\n\nNOTE hello\n\n00:00:01.000 --> 00:00:03.000\nHello there friend\n").length, 1);
const plain = parseTranscript("Line one is here.\n[B-ROLL: beach]\nLine two follows on.", "notes.txt");
assert.equal(plain.estimated, true);
assert.equal(plain.cues.length, 2);
assert.ok(plain.cues[1].startS > 0);

// ---- beats stay inside the 3 to 15 second window (except a lone short script)
const script = Array.from({ length: 12 }, (_, i) => `This is sentence number ${i + 1} and it has a fair few words in it.`).join(" ");
const beats = beatsFromText(script);
assert.ok(beats.length > 1);
for (const b of beats.slice(0, -1)) assert.ok(b.endS - b.startS >= 2.5 && b.endS - b.startS <= 15.5, `beat ${b.index} is ${b.endS - b.startS}s`);
assert.equal(beats[0].startS, 0);
for (let i = 1; i < beats.length; i++) assert.ok(Math.abs(beats[i].startS - beats[i - 1].endS) < 0.01, "beats are contiguous");
// a single very long cue is divided
const long = beatsFromText(`00:00:00,000 --> 00:00:40,000`.replace(/^/, "1\n") + "\n" + "word ".repeat(120), "x.srt");
assert.ok(long.length >= 3 && long.every((b) => b.endS - b.startS <= 15.1));
assert.deepEqual(beatsFromText("   \n "), []);
assert.equal(clock(65), "1:05");

// ---- rerank prompt and reading
const cand = [
  { caption: "Man walks on a beach at sunrise", shotType: "wide", setting: "beach", action: "walking", emotions: ["calm"], media: "video" as const, durationS: 6.2 },
  { caption: "Alarm clock", shotType: "close", setting: "bedroom", action: null, emotions: [], media: "image" as const, durationS: null },
];
const prompt = rerankUserPrompt({ index: 0, startS: 0, endS: 8, text: "Slowing down" }, cand);
assert.match(prompt, /beat 1, 8\.0s/);
assert.match(prompt, /1\. Man walks on a beach at sunrise \[wide, beach, walking; mood: calm; 6\.2s\]/);
assert.match(prompt, /still photograph/);
const good = readRerank({ choices: [{ candidate: 2, reason: "  calm  ", confidence: 3 }, { candidate: 2, reason: "dup" }, { candidate: 9, reason: "out of range" }, { candidate: "x" }, { candidate: 1, confidence: "nope" }], no_good_match: false }, 2)!;
assert.deepEqual(good.choices.map((c) => c.index), [1, 0]);
assert.equal(good.choices[0].confidence, 1);
assert.equal(good.choices[0].reason, "calm");
assert.equal(good.choices[1].confidence, 0.5);
assert.equal(readRerank(null, 2), null);
assert.equal(readRerank("nope", 2), null);
assert.equal(readRerank({ choices: [], no_good_match: true, missing_footage: " a slow sunrise " }, 3)!.missing, "a slow sunrise");

// ---- ordering: model picks first, then search order; a reused clip drops
const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
assert.deepEqual(orderCandidates(items, null, {}).map((r) => r.item.id), ["a", "b", "c", "d"]);
const withModel = orderCandidates(items, { choices: [{ index: 2, reason: "r", confidence: 0.9 }, { index: 0, reason: "s", confidence: 0.6 }], noGoodMatch: false, missing: null }, {});
assert.deepEqual(withModel.map((r) => r.item.id), ["c", "a", "b", "d"]);
assert.equal(withModel[0].reason, "r");
const varied = orderCandidates(items, { choices: [{ index: 2, reason: "r", confidence: 0.9 }, { index: 0, reason: "s", confidence: 0.6 }], noGoodMatch: false, missing: null }, { c: 1 });
assert.deepEqual(varied.map((r) => r.item.id).slice(0, 2), ["a", "c"]); // 1*0.45 < 0.5
assert.equal(varied.find((r) => r.item.id === "c")!.reused, true);
assert.ok(REPEAT_PENALTY < 1);

// ---- timecode and timebase
assert.equal(timecode(0, 25), "00:00:00:00");
assert.equal(timecode(25 * 61 + 3, 25), "00:01:01:03");
assert.deepEqual(ntscTimebase(29.97), { timebase: 30, ntsc: true });
assert.deepEqual(ntscTimebase(25), { timebase: 25, ntsc: false });

// ---- exports
const shot = (id: string, over: Partial<ExportShot> = {}): ExportShot => ({
  id, sourceId: `src-${id}`, filename: `${id}.mov`, drivePath: `Videos/04_Daily Rituals/Sleep & Rest/${id}.mov`, driveLink: `https://drive/${id}`,
  startS: 2, durationS: 10, media: "video", shotType: "wide", setting: "bedroom", ...over,
});
const sug = (s: ExportShot, reason = "fits, the mood") => ({ shot: s, reason, confidence: 0.8, reused: false });
const matches: ExportBeat[] = [
  { beat: { index: 0, startS: 0, endS: 8, text: 'She said "go" & left', estimated: false }, suggestions: [sug(shot("a")), sug(shot("b"))], missing: null },
  { beat: { index: 1, startS: 8, endS: 20, text: "A long beat needing more than the clip has", estimated: false }, suggestions: [sug(shot("c", { durationS: 5 }))], missing: null },
  { beat: { index: 2, startS: 20, endS: 26, text: "Nothing fits", estimated: false }, suggestions: [], missing: "A slow sunrise over water" },
  { beat: { index: 3, startS: 26, endS: 30, text: "A photo holds", estimated: false }, suggestions: [sug(shot("p", { media: "image", durationS: null, startS: 0 }))], missing: null },
];
const cfg = { name: "Test & Cut", fps: 25, width: 1080, height: 1920, mountPath: "/Users/x/My Drive/B-Roll/" };
const tl = buildTimeline(matches, cfg);
assert.equal(tl.items.length, 3);
assert.equal(tl.gaps.length, 1);
assert.equal(tl.items[0].startFrame, 0);
assert.equal(tl.items[0].endFrame, 200);
assert.equal(tl.items[0].inFrame, 50);
assert.equal(tl.items[0].outFrame, 250);
assert.equal(tl.items[1].gapFrames, 12 * 25 - 5 * 25); // clip is 5s of a 12s beat
assert.ok(tl.warnings.some((w) => /longer than c\.mov/.test(w)));
assert.equal(tl.items[2].gapFrames, 0); // still photo holds the beat
assert.equal(tl.items[0].mediaPath, "/Users/x/My Drive/B-Roll/Videos/04_Daily Rituals/Sleep & Rest/a.mov");
assert.equal(tl.items[0].offline, false);
assert.equal(buildTimeline(matches, { ...cfg, mountPath: "" }).items[0].offline, true);
assert.ok(buildTimeline(matches, { ...cfg, mountPath: "" }).warnings.some((w) => /relinking/.test(w)));

const xml = fcp7Xml(tl);
assert.match(xml, /<name>Test &amp; Cut<\/name>/);
assert.match(xml, /<pathurl>file:\/\/localhost\/Users\/x\/My%20Drive\/B-Roll\/Videos\/04_Daily%20Rituals\/Sleep%20%26%20Rest\/a\.mov<\/pathurl>/);
assert.match(xml, /She said &quot;go&quot; &amp; left/);
assert.equal((xml.match(/<clipitem /g) ?? []).length, 3);
assert.equal((xml.match(/<file id="file-\d+">/g) ?? []).length, 3);
// well-formed, when a real XML checker is on the machine
try {
  const f = join(mkdtempSync(join(tmpdir(), "broll-")), "t.xml");
  writeFileSync(f, xml);
  execFileSync("xmllint", ["--noout", f]);
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}

const e = edl(tl);
assert.match(e, /^TITLE: Test & Cut\nFCM: NON-DROP FRAME/);
assert.match(e, /001  AXX      V     C        00:00:02:00 00:00:10:00 00:00:00:00 00:00:08:00/);
assert.match(e, /\* GAP AFTER: 175 frames \(7\.0s\)/);

const c = csv(matches, tl);
const lines = c.trimEnd().split("\n");
assert.match(lines[0], /^beat,beat_start/);
assert.ok(lines.some((l) => l.includes("no good match") && l.includes("A slow sunrise over water")));
assert.ok(c.includes('"She said ""go"" & left"'));
assert.ok(lines.some((l) => l.includes(",alternative")));
assert.equal(lines.filter((l) => l.includes(",placed")).length, 3);
console.log("broll: all checks passed");
