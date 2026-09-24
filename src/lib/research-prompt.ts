/**
 * The Monday research prompt: what the client's own ChatGPT or Claude is asked to
 * do each week. Pure text so it can be tested and shown anywhere. The AI reads the
 * client's offer and ideal-client docs through the dashboard connector, browses
 * the platforms with the client's own logged-in browser, and adds what it finds to
 * the Top posts list, which the weekly digest then reports.
 */

export interface ResearchPromptInput {
  /** Titles of the docs in Library → SOP / Playbook, so the AI knows what to read. */
  docTitles: string[];
  /** Add the best finds straight away instead of asking first. */
  autoAdd: boolean;
  appUrl: string;
}

export function buildResearchPrompt({ docTitles, autoAdd, appUrl }: ResearchPromptInput): string {
  const docs = docTitles.length
    ? `Read these docs in my Content Ops playbook first (use list_playbook_docs, then get_playbook_doc): ${docTitles.map((t) => `"${t}"`).join(", ")}. They say what I sell and who my ideal client is.`
    : `Read my offer and ideal-client docs from my Content Ops playbook first (use list_playbook_docs, then get_playbook_doc). If there are none, ask me two questions instead: what do I sell, and who is my ideal client?`;

  return [
    "You are my weekly content researcher.",
    "",
    "1. " + docs,
    "2. Use list_top_posts to see what is already saved, so you don't repeat it.",
    "3. Using my logged-in browser, search Instagram (and TikTok and YouTube Shorts if you can) for short-form posts from the last 30 days that would resonate with my ideal client and relate to my offer. Look at hashtags, search terms and accounts in my niche.",
    "4. Keep only genuine outliers: posts that got far more views than that account usually gets. For each, capture: the topic, the exact opening hook, the view count as shown, the link, the platform and the creator. Only use numbers you can actually see on the page.",
    autoAdd
      ? "5. Pick the best 8 to 10 and add them straight away with add_top_posts (source: inspiration). Don't wait for me."
      : "5. Show me your best 8 to 10 as a short list, then wait. Add the ones I approve with add_top_posts (source: inspiration).",
    "6. Finish with two lines: what patterns the winners share, and one idea I could film this week using them.",
    "",
    `If the connector isn't available, give me the posts as a table (Views | Topic | Hook | Link | Platform | Creator) I can paste into ${appUrl.replace(/\/$/, "")}/library/top-posts.`,
  ].join("\n");
}

/** One-click links that open a new chat with the prompt already typed in. */
export function promptLinks(prompt: string) {
  const q = encodeURIComponent(prompt);
  return {
    chatgpt: `https://chatgpt.com/?q=${q}`,
    claude: `https://claude.ai/new?q=${q}`,
  };
}
