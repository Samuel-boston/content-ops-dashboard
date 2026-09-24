import "server-only";
import { chatJSON } from "@/lib/integrations/ai";

export interface IdeaTriage {
  /** A short working heading — never the whole message. */
  title: string;
  /** One or two sentences: just enough to remember what was meant. */
  brief: string | null;
  /** True when the idea is clearly an image carousel rather than a video. */
  carousel: boolean;
}

const MAX_TITLE = 70;

function cut(s: string, max: number) {
  const line = s.split("\n")[0].trim();
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}

/**
 * Turn a quick message — however long or rambling — into an idea that's ready
 * to sit in Ideation: a proper heading, a one-line brief, and whether it
 * sounds like a carousel or a video. Uses the workspace's text model (free on
 * Groq); if that's unavailable or answers badly, falls back to the first line
 * so an idea is never lost, just less tidy.
 */
export async function triageIdea(text: string): Promise<IdeaTriage> {
  const trimmed = text.trim();
  const fallback: IdeaTriage = { title: cut(trimmed, MAX_TITLE), brief: null, carousel: false };
  if (!trimmed) return fallback;

  const out = await chatJSON<{ title?: string; brief?: string; format?: string }>(
    "You file quick content ideas for a social-media video agency. The message may be long, rambling " +
      "or dictated. Turn it into a tidy idea. Never invent details that aren't in the message.",
    `Message:\n"""\n${trimmed.slice(0, 4000)}\n"""\n\n` +
      `Respond as JSON: {"title": "...", "brief": "...", "format": "carousel" | "video"}\n` +
      `- title: a clear working heading, 4-9 words, no quotation marks, no full stop.\n` +
      `- brief: one or two sentences capturing the point, or "" if the title says it all.\n` +
      `- format: "carousel" ONLY if the message clearly describes an image carousel (mentions a carousel, ` +
      `slides, swiping, or a set of images/text cards). Otherwise "video".`
  );

  const title = out?.title?.replace(/^["'“]+|["'”.]+$/g, "").trim();
  if (!title) return fallback;
  return {
    title: cut(title, MAX_TITLE),
    brief: out?.brief?.trim() || null,
    carousel: out?.format?.toLowerCase().startsWith("carousel") ?? false,
  };
}
