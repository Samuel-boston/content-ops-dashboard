// Exercises the pure helpers behind the B-roll section.
//   npx tsx scripts/test-broll.mts
import assert from "node:assert/strict";
import { folderName, splitBeats, NO_CATEGORY } from "../src/lib/broll.ts";

assert.equal(folderName("04_Daily Rituals"), "Daily Rituals");
assert.equal(folderName("Daily Rituals"), "Daily Rituals");
assert.equal(folderName("12 - Life Chapters"), "Life Chapters");
assert.equal(folderName("07_"), "07_");
assert.equal(NO_CATEGORY, "__none");

// one beat per line; timecodes, stage notes and one-word lines are dropped
assert.deepEqual(splitBeats("I woke up at five every morning\n\n[B-ROLL]\n0:12 - Then I sat by the sea\nOK\n(00:20) [pause] breathing slowly in the dark"), [
  "I woke up at five every morning",
  "Then I sat by the sea",
  "breathing slowly in the dark",
]);
// a long single paragraph splits into sentences
const long = "First I would walk down to the water before anyone else was awake. " + "Then I would stand there and simply breathe in the cold air for a while. ".repeat(2) + "It changed everything about how my days began and ended.";
assert.ok(splitBeats(long).length >= 3);
assert.deepEqual(splitBeats("   \n \n"), []);
console.log("broll: all checks passed");
