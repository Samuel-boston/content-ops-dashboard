import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWorkspaceSettings } from "@/lib/workspace";
import { buildResearchPrompt, promptLinks } from "@/lib/research-prompt";

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

/** The prompt to run this week: the custom one if the owner wrote it, else the default built from the playbook. */
export async function currentResearchPrompt(db: SupabaseClient) {
  const [settings, { data: docs }] = await Promise.all([
    getWorkspaceSettings(),
    db.from("sop_docs").select("title").order("position").order("created_at").limit(20),
  ]);
  const docTitles = (docs ?? []).map((d) => d.title as string);
  const custom = settings.research_prompt?.trim();
  const prompt = custom || buildResearchPrompt({ docTitles, autoAdd: settings.research_auto_add, appUrl: appUrl() });
  return { prompt, custom: Boolean(custom), autoAdd: settings.research_auto_add, docTitles, ...promptLinks(prompt) };
}

export interface ResearchFind {
  topic: string;
  hook: string | null;
  views: number | null;
  link: string | null;
  creator: string | null;
  platform: string | null;
}

export interface ResearchBlock {
  prompt: string;
  chatgptUrl: string;
  claudeUrl: string;
  /** Posts added to the Top posts list in the last 7 days. */
  finds: ResearchFind[];
}

/** What the Monday digest says about research: the one-click prompt, and what last week's run turned up. */
export async function buildResearchBlock(db: SupabaseClient, now = new Date()): Promise<ResearchBlock> {
  const since = new Date(now.getTime() - 7 * 864e5).toISOString();
  const [cur, { data: finds }] = await Promise.all([
    currentResearchPrompt(db),
    db
      .from("top_posts")
      .select("topic, hook, views, link, creator, platform")
      .gte("created_at", since)
      .order("views", { ascending: false, nullsFirst: false })
      .limit(8),
  ]);
  return { prompt: cur.prompt, chatgptUrl: cur.chatgpt, claudeUrl: cur.claude, finds: (finds as ResearchFind[]) ?? [] };
}

/**
 * Tell an automation tool (Zapier, Make, n8n…) it's research day. The payload
 * carries the prompt and both one-click links, so the tool can post it somewhere,
 * start a chat, or call an AI's own API. Best-effort: a dead webhook never stops
 * the digest.
 */
export async function sendResearchWebhook(block: ResearchBlock): Promise<{ ok: boolean; status?: number; error?: string } | null> {
  const settings = await getWorkspaceSettings();
  const url = settings.research_webhook_url?.trim();
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "weekly_research",
        generated_at: new Date().toISOString(),
        prompt: block.prompt,
        chatgpt_url: block.chatgptUrl,
        claude_url: block.claudeUrl,
        dashboard_url: appUrl(),
        top_posts_url: `${appUrl()}/library/top-posts`,
        api: { list_top_posts: `${appUrl()}/api/ai/top-posts`, add_top_posts: `${appUrl()}/api/ai/top-posts`, playbook: `${appUrl()}/api/ai/playbook` },
        finds_last_7_days: block.finds.length,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
