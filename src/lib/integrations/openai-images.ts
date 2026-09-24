import "server-only";
import { getWorkspaceSettings } from "@/lib/workspace";
import { NotConfiguredError } from "@/lib/integrations/stream";

/**
 * Carousel slide generation — gpt-image-1 through the workspace's existing
 * OpenAI key (the one Whisper already uses; Settings → Integrations, no new
 * credential).
 *
 * Two calls, one function: a plain prompt goes to /images/generations; pass
 * reference images (the current slide for a "change this" regeneration,
 * and/or frames from the footage index) and it switches to /images/edits,
 * which takes the images as multipart files and grounds the result in them.
 *
 * 1024x1536 portrait — the closest gpt-image-1 size to Instagram's 4:5
 * carousel frame; the prompt asks for 4:5-safe composition and IG's own crop
 * does the rest.
 */

const SIZE = "1024x1536";

export type ImageSize = "1024x1536" | "1536x1024" | "1024x1024";

async function apiKey(): Promise<string> {
  const s = await getWorkspaceSettings();
  if (!s.openai_api_key) throw new NotConfiguredError("OpenAI (for image generation)");
  return s.openai_api_key;
}

export interface SlideReference {
  data: Buffer;
  mime: string;
  name: string;
}

export async function generateSlideImage(opts: {
  prompt: string;
  references?: SlideReference[];
  /** Defaults to portrait (carousel slides); a thumbnail asks for landscape. */
  size?: ImageSize;
}): Promise<Buffer> {
  const size = opts.size ?? SIZE;
  const key = await apiKey();
  const refs = opts.references ?? [];

  let res: Response;
  if (refs.length === 0) {
    res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: opts.prompt,
        size,
        quality: "high",
        n: 1,
      }),
    });
  } else {
    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("prompt", opts.prompt);
    form.append("size", size);
    form.append("quality", "high");
    for (const r of refs) {
      form.append("image[]", new Blob([new Uint8Array(r.data)], { type: r.mime }), r.name);
    }
    res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
  }

  if (!res.ok) {
    let message = `OpenAI image API: HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      /* keep the HTTP message */
    }
    throw new Error(message);
  }

  const body = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image.");
  return Buffer.from(b64, "base64");
}
