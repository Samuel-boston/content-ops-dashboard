// Builds docs/04-integration-guides.md from the same source the Settings page uses (src/lib/setup-guides.ts),
// then the two combined files. Run:  npm run build:docs
import { readFileSync, writeFileSync } from "node:fs";
import { SETUP_GUIDES } from "../src/lib/setup-guides.ts";

const app = "https://YOUR-SITE.vercel.app";
let out = `# 4 · Integration guides

Each guide can be done **three ways**. In the dashboard open **avatar menu → Settings → Set up your integrations** and pick a tab:

- **Manually** — follow the steps below.
- **Claude Chrome extension** — install and connect the Claude extension in Chrome, press **Copy the prompt** on the guide, paste it into Claude. It does the clicking and stops at logins, verification codes and payments.
- **ChatGPT computer control** — the same prompt, for ChatGPT's agent/computer control on your Mac.

The prompts contain no passwords or keys. The AI types values only into the boxes in Settings. Save settings after each one and test it.

Recommended order: **Google Drive → Groq → scheduled jobs → Telegram → Publer (or Instagram) → Slack → email → your own Claude.** (Cloudflare Stream was done on the call.)

`;
for (const g of SETUP_GUIDES) {
  out += `---\n\n## ${g.title}\n\n${g.blurb}\n\n### Steps\n\n${g.steps.map((s, i) => `${i + 1}. ${s.replaceAll("{app}", app)}`).join("\n")}\n\n### Paste into Settings\n\n${g.fields.map((f) => `- ${f}`).join("\n")}\n\n### Then\n\n${g.finish}\n\n`;
}
writeFileSync("docs/04-integration-guides.md", out);

const files = ["01-before-the-call", "02-on-the-call", "03-after-the-call", "04-integration-guides", "05-how-it-works", "06-running-it"];
const read = (f: string) => readFileSync(`docs/${f}.md`, "utf8").trim();
const sep = "\n\n---\n\n---\n\n";
writeFileSync("docs/HANDOVER-PACK.md", `# Content Ops — full handover pack\n\n` + readFileSync("docs/README.md", "utf8").split("\n").slice(2).join("\n").trim() + sep + files.map(read).join(sep) + "\n");
writeFileSync("docs/CLIENT-RESOURCE.md", `# Content Ops — your resource\n\nStart with **3 · After the call**. Keep the rest for reference.\n\n` + files.slice(2).map(read).join(sep) + "\n");
console.log("built docs");
