import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getWorkspaceSettings } from "@/lib/workspace";
import type { WorkspaceSettings } from "@/lib/types";

// Text generation can run on Groq (free tier), real Claude, or OpenAI —
// whichever a workspace picks in Settings → Integrations. `chatText`/
// `chatJSON` below are the one surface every AI-scripting feature calls;
// none of them know or care which provider actually answered.
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-120b";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4.1-mini";
const ANTHROPIC_MODEL = "claude-opus-5";

/** Groq and OpenAI's chat-completions APIs are request-for-request identical — one adapter for both. */
async function completeOpenAICompatible(
  url: string,
  model: string,
  apiKey: string,
  system: string,
  user: string,
  jsonMode: boolean
): Promise<string | null> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.8,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content;
  return typeof text === "string" ? text.trim() : null;
}

/** Real Claude, via the official SDK. No native "JSON mode" — asked for directly in the prompt instead, same as every other model that lacks one. */
async function completeAnthropic(
  apiKey: string,
  system: string,
  user: string,
  jsonMode: boolean
): Promise<string | null> {
  const client = new Anthropic({ apiKey });
  try {
    const res = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      system,
      messages: [
        {
          role: "user",
          content: jsonMode
            ? `${user}\n\nRespond with ONLY valid JSON — no markdown code fences, no other text.`
            : user,
        },
      ],
    });
    const block = res.content.find((b) => b.type === "text");
    return block && "text" in block ? block.text.trim() : null;
  } catch {
    return null;
  }
}

async function complete(system: string, user: string, jsonMode: boolean): Promise<string | null> {
  const s = await getWorkspaceSettings();
  const provider = s.ai_provider || "groq";

  if (provider === "anthropic") {
    if (!s.anthropic_api_key) return null;
    return completeAnthropic(s.anthropic_api_key, system, user, jsonMode);
  }
  if (provider === "openai") {
    if (!s.openai_api_key) return null;
    return completeOpenAICompatible(OPENAI_URL, OPENAI_MODEL, s.openai_api_key, system, user, jsonMode);
  }
  if (!s.groq_api_key) return null;
  return completeOpenAICompatible(GROQ_URL, GROQ_MODEL, s.groq_api_key, system, user, jsonMode);
}

/** Plain-text completion. Returns null when the active provider has no key, or the call otherwise failed — never throws. */
export async function chatText(system: string, user: string): Promise<string | null> {
  return complete(system, user, false);
}

/** JSON-mode completion, parsed. Returns null on any failure — the caller decides the message. */
export async function chatJSON<T>(system: string, user: string): Promise<T | null> {
  const text = await complete(system, user, true);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

const PROVIDER_LABEL: Record<WorkspaceSettings["ai_provider"], string> = {
  groq: "Groq",
  anthropic: "Claude",
  openai: "OpenAI",
};

function hasKeyFor(s: WorkspaceSettings, provider: WorkspaceSettings["ai_provider"]): boolean {
  if (provider === "anthropic") return Boolean(s.anthropic_api_key);
  if (provider === "openai") return Boolean(s.openai_api_key);
  return Boolean(s.groq_api_key);
}

/**
 * `chatText`/`chatJSON` return the same plain `null` whether the active
 * provider has no key at all, or a configured one just had a bad moment
 * (rate limit, timeout, hiccup) — callers only ever see "null" either way.
 * Call this to pick the right message for whichever it actually was, naming
 * whichever provider is actually active, instead of every failure reading
 * as "you haven't set this up" even when you have.
 */
export async function aiErrorMessage(): Promise<string> {
  const s = await getWorkspaceSettings();
  const provider = s.ai_provider || "groq";
  const label = PROVIDER_LABEL[provider];
  return hasKeyFor(s, provider)
    ? `${label} didn't respond just now — try again in a moment.`
    : `This needs a ${label} key — add one in Settings → Integrations.`;
}
