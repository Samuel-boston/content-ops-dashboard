// npx tsx scripts/test-research-prompt.mts
import assert from "node:assert/strict";
import { buildResearchPrompt, promptLinks } from "../src/lib/research-prompt.ts";

const auto = buildResearchPrompt({ docTitles: ["Our offer", "Ideal client"], autoAdd: true, appUrl: "https://x.vercel.app/" });
assert.match(auto, /"Our offer", "Ideal client"/);
assert.match(auto, /add_top_posts/); assert.match(auto, /Don't wait for me/);
assert.match(auto, /https:\/\/x\.vercel\.app\/library\/top-posts/);
const ask = buildResearchPrompt({ docTitles: [], autoAdd: false, appUrl: "https://x" });
assert.match(ask, /wait\. Add the ones I approve/); assert.match(ask, /what do I sell/);
assert.doesNotMatch(ask, /Don't wait for me/);
const l = promptLinks("find viral & good stuff?");
assert.ok(l.chatgpt.startsWith("https://chatgpt.com/?q=") && l.chatgpt.includes("%26"));
assert.ok(l.claude.startsWith("https://claude.ai/new?q="));
assert.ok(l.chatgpt.length < 6000, "fits in a URL");
console.log("research prompt: all checks passed");
