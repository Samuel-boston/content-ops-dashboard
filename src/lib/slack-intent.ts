/**
 * What a Slack message is asking for. Pure text-in, intent-out — no database, no
 * network — so it can be tested on its own and read in one sitting.
 *
 * The phrasings are deliberately loose ("yo, add this to ideas", "how many
 * videos we got in scripting", "what's with the VA"), because nobody types a
 * command syntax into a chat. Anything it can't place becomes `unknown`, and the
 * caller may hand that to the AI or just show help — it never guesses an action.
 */

export type StageKey =
  | "ideation"
  | "scripting"
  | "needs_creatives"
  | "creative_review"
  | "ready_to_film"
  | "editor_brief"
  | "ready_to_edit"
  | "in_progress"
  | "in_review"
  | "revisions"
  | "awaiting_variants"
  | "final_review"
  | "with_va"
  | "posted";

export type SlackIntent =
  | { kind: "help" }
  | { kind: "add_idea"; text: string }
  | { kind: "count"; stage: StageKey | null }
  | { kind: "list"; stage: StageKey | null }
  | { kind: "find"; query: string }
  | { kind: "move"; query: string; stage: StageKey }
  | { kind: "unknown"; text: string };

/** Order matters: the specific phrases have to be tried before the generic ones they contain. */
const STAGE_WORDS: [RegExp, StageKey][] = [
  [/\b(creatives? to review|creative review)\b/, "creative_review"],
  [/\b(needs? creatives?|creatives?)\b/, "needs_creatives"],
  [/\bfinal( review)?\b/, "final_review"],
  [/\b(awaiting variants?|variants?)\b/, "awaiting_variants"],
  [/\b(ready to edit|editor pool|the pool)\b/, "ready_to_edit"],
  [/\b(ready to film|filming|to film)\b/, "ready_to_film"],
  [/\b(editor brief|briefs?)\b/, "editor_brief"],
  [/\b(in progress|being edited|editing)\b/, "in_progress"],
  [/\brevisions?\b/, "revisions"],
  [/\b(in review|to review|review)\b/, "in_review"],
  [/\b(with the va|the va|va|posting)\b/, "with_va"],
  [/\bposted\b/, "posted"],
  [/\b(scripting|scripts?|being written)\b/, "scripting"],
  [/\b(ideation|ideas?)\b/, "ideation"],
];

export const STAGE_LABEL: Record<StageKey, string> = {
  ideation: "Ideation",
  scripting: "Scripting",
  needs_creatives: "Needs Creatives",
  creative_review: "Creatives to Review",
  ready_to_film: "Ready to Film",
  editor_brief: "Editor Brief",
  ready_to_edit: "Ready to Edit",
  in_progress: "Editing",
  in_review: "In Review",
  revisions: "Revisions",
  awaiting_variants: "Awaiting Variants",
  final_review: "Final Review",
  with_va: "With the VA",
  posted: "Posted",
};

export function stageIn(text: string): StageKey | null {
  const t = text.toLowerCase();
  for (const [re, key] of STAGE_WORDS) if (re.test(t)) return key;
  return null;
}

/** Slack wraps links and mentions in <…>; unwrap them to the words a person would read. */
export function cleanSlackText(raw: string): string {
  return raw
    .replace(/<@[A-Z0-9]+(\|[^>]*)?>/g, "") // @mentions of the bot (and people)
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .replace(/<(https?:[^>|]+)\|([^>]+)>/g, "$1")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

const ADD_IDEA = /^(?:(?:yo|hey|please|pls)[,!]?\s+)?(?:(?:add|new|log|save|create|put|park|drop)\s+)?(?:(?:this|that|it)\s+(?:to|in|into)\s+)?(?:an?\s+|the\s+|my\s+)?ideas?\b\s*[:\-–—,]?\s*(.*)$/i;
const ADD_THIS = /^(?:(?:yo|hey|please|pls)[,!]?\s+)?(?:add|put|save|log|park|drop)\s+(.+?)\s+(?:to|in|into|as)\s+(?:the\s+)?(?:ideas?|ideation)\b\s*$/i;

export function parseIntent(raw: string): SlackIntent {
  const text = cleanSlackText(raw);
  const lower = text.toLowerCase();

  if (!text || /^(help|\?|commands|what can you do\??|hi|hello|hey)$/i.test(text)) return { kind: "help" };

  // "add this to ideas: <text>" / "idea: <text>" / "add idea <text>" / "<text> to ideas"
  const tail = ADD_THIS.exec(text);
  if (tail && tail[1].trim()) return { kind: "add_idea", text: tail[1].trim() };
  const head = ADD_IDEA.exec(text);
  if (head && /^(?:.*?)ideas?\b/i.test(text)) {
    const body = head[1].trim();
    // "ideas" on its own is a question about the stage, not an idea to add.
    if (body && !/^(?:in|are|do|how|what|list|show)\b/i.test(body)) return { kind: "add_idea", text: body };
    if (!body && /^(?:add|new|log|save|create)\b/i.test(text)) return { kind: "help" };
  }

  // move <title> to <stage>
  const mv = /^move\s+(.+?)\s+(?:to|into)\s+(.+)$/i.exec(text);
  if (mv) {
    const stage = stageIn(mv[2]);
    if (stage) return { kind: "move", query: mv[1].replace(/^["“']|["”']$/g, "").trim(), stage };
  }

  const find = /^(?:find|search(?: for)?|look up|where(?:'s| is)|show me)\s+(.+)$/i.exec(text);
  if (find && !stageIn(find[1])) return { kind: "find", query: find[1].replace(/^["“']|["”']$/g, "").trim() };

  const stage = stageIn(lower);
  if (/\bhow many\b|\bcount\b|\bnumber of\b|\bhow much\b/.test(lower)) return { kind: "count", stage };
  if (/^(?:list|show|what(?:'s| is| are)?|whats|which|who|see|give me)\b/.test(lower) && stage) return { kind: "list", stage };
  if (stage && /\b(?:in|at|with)\b/.test(lower) && /^(?:what|which|list|show|whats)/.test(lower)) return { kind: "list", stage };
  if (/\b(pipeline|status|overview|summary|board|state of)\b/.test(lower) && !stage) return { kind: "count", stage: null };
  if (stage && /^(?:in|the|videos?|ideas?|scripts?)\b/.test(lower)) return { kind: "list", stage };

  return { kind: "unknown", text };
}

export const HELP_TEXT = [
  "*What I can do*",
  "• `add idea <your idea>` — puts it in Ideation (also: `idea: …`, or _add this to ideas: …_)",
  "• `how many in scripting` — a count for any stage; `pipeline` for all of them",
  "• `what's in scripting` / `list ready to edit` — the titles, with links",
  "• `find <words>` — search videos by title",
  "• `move <title> to scripting` — owners and admins can move an idea between Ideation, Scripting and Ready to Film",
  "Say it in your own words too — I'll try to work it out.",
].join("\n");
