// Exercises src/lib/slack-intent.ts.  npx tsx scripts/test-slack.mts
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { parseIntent, stageIn, cleanSlackText } from "../src/lib/slack-intent.ts";
import { verifySlackSignature } from "../src/lib/slack-signature.ts";

const k = (s: string) => parseIntent(s);

// ideas
assert.deepEqual(k("add idea: 5 mistakes new coaches make"), { kind: "add_idea", text: "5 mistakes new coaches make" });
assert.deepEqual(k("idea: film a morning routine reel"), { kind: "add_idea", text: "film a morning routine reel" });
assert.deepEqual(k("Yo, add this to ideas: carousel on burnout signs"), { kind: "add_idea", text: "carousel on burnout signs" });
assert.deepEqual(k("add this to ideas - talk about nervous system reset"), { kind: "add_idea", text: "talk about nervous system reset" });
assert.deepEqual(k("add why sleep matters to ideas"), { kind: "add_idea", text: "why sleep matters" });
assert.deepEqual(k("new idea a video about airport anxiety"), { kind: "add_idea", text: "a video about airport anxiety" });
assert.equal(k("how many ideas do we have").kind, "count");
assert.equal(k("add idea").kind, "help");

// counts
assert.deepEqual(k("how many videos we got in scripting?"), { kind: "count", stage: "scripting" });
assert.deepEqual(k("how many are with the VA"), { kind: "count", stage: "with_va" });
assert.deepEqual(k("how many in ready to edit"), { kind: "count", stage: "ready_to_edit" });
assert.deepEqual(k("pipeline"), { kind: "count", stage: null });
assert.deepEqual(k("status"), { kind: "count", stage: null });

// lists
assert.deepEqual(k("what's in scripting"), { kind: "list", stage: "scripting" });
assert.deepEqual(k("list final review"), { kind: "list", stage: "final_review" });
assert.deepEqual(k("what videos are in review?"), { kind: "list", stage: "in_review" });
assert.deepEqual(k("show me what's with the VA"), { kind: "list", stage: "with_va" });

// find / move
assert.deepEqual(k("find burnout"), { kind: "find", query: "burnout" });
assert.deepEqual(k('where is "morning routine"'), { kind: "find", query: "morning routine" });
assert.deepEqual(k("move morning routine to scripting"), { kind: "move", query: "morning routine", stage: "scripting" });

assert.deepEqual(k("top posts"), { kind: "top" });
assert.deepEqual(k("what's working"), { kind: "top" });

// help / unknown
assert.equal(k("").kind, "help");
assert.equal(k("help").kind, "help");
assert.equal(k("lunch at 1?").kind, "unknown");

// slack markup
assert.equal(cleanSlackText("<@U123ABC> add idea: see <https://x.com/a|this> &amp; that"), "add idea: see https://x.com/a & that");
assert.deepEqual(k("<@U123ABC> how many in scripting"), { kind: "count", stage: "scripting" });
assert.equal(stageIn("Creatives"), "needs_creatives");
assert.equal(stageIn("final review"), "final_review");
assert.equal(stageIn("in review"), "in_review");
// signatures
const secret = "shh-its-a-secret-value";
const body = "token=x&text=how+many&user_id=U1";
const ts = String(Math.floor(Date.now() / 1000));
const sig = "v0=" + crypto.createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex");
assert.equal(verifySlackSignature({ rawBody: body, timestamp: ts, signature: sig, signingSecret: secret }), true);
assert.equal(verifySlackSignature({ rawBody: body + "x", timestamp: ts, signature: sig, signingSecret: secret }), false, "tampered body");
assert.equal(verifySlackSignature({ rawBody: body, timestamp: ts, signature: sig, signingSecret: "other-secret-value-1" }), false, "wrong secret");
assert.equal(verifySlackSignature({ rawBody: body, timestamp: ts, signature: null, signingSecret: secret }), false, "missing signature");
const old = String(Math.floor(Date.now() / 1000) - 3600);
const oldSig = "v0=" + crypto.createHmac("sha256", secret).update(`v0:${old}:${body}`).digest("hex");
assert.equal(verifySlackSignature({ rawBody: body, timestamp: old, signature: oldSig, signingSecret: secret }), false, "replayed old request");
console.log("slack: all checks passed");
