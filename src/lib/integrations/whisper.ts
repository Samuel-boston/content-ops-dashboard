import "server-only";
import { getWorkspaceSettings } from "@/lib/workspace";

export const NO_OPENAI_KEY = "This needs an OpenAI key — add one in Settings → Integrations.";

/**
 * The generic "no key" message was covering up real OpenAI errors (rate
 * limits, an exhausted billing balance, a bad request) behind one misleading
 * line. Every caller gets the actual reason now, not a guess.
 */
function whisperError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; code?: string } };
    if (parsed.error?.message) return `OpenAI: ${parsed.error.message}`;
  } catch {
    /* not JSON — fall through to the status-based message */
  }
  if (status === 401) return "OpenAI rejected that key — check it in Settings → Integrations.";
  if (status === 429) return "OpenAI rate-limited or out of quota — check billing at platform.openai.com.";
  return `OpenAI transcription failed (${status}).`;
}

/** Transcribe an audio file (from a URL) with OpenAI Whisper. */
export async function transcribeAudio(audioUrl: string): Promise<{ text: string } | { error: string }> {
  const s = await getWorkspaceSettings();
  if (!s.openai_api_key) return { error: NO_OPENAI_KEY };

  const audio = await fetch(audioUrl);
  if (!audio.ok) return { error: "Couldn't read the recording." };
  const blob = await audio.blob();

  const form = new FormData();
  form.append("file", blob, "voice-note.ogg");
  form.append("model", "whisper-1");
  form.append("response_format", "text");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${s.openai_api_key}` },
    body: form,
  });
  if (!res.ok) return { error: whisperError(res.status, await res.text()) };
  return { text: (await res.text()).trim() };
}

export interface TimedCue {
  start: number;
  end: number;
  text: string;
}

/**
 * Transcribe with segment timings, for the Transcript tab — selecting a phrase
 * there has to map back to an exact in/out point on the timeline, so the plain
 * text response isn't enough.
 */
export async function transcribeWithTimestamps(
  mediaUrl: string
): Promise<{ language: string; cues: TimedCue[] } | { error: string }> {
  const s = await getWorkspaceSettings();
  if (!s.openai_api_key) return { error: NO_OPENAI_KEY };

  const media = await fetch(mediaUrl);
  if (!media.ok) return { error: "Couldn't read the recording." };
  const blob = await media.blob();

  const form = new FormData();
  form.append("file", blob, "cut.mp4");
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  // Segment granularity gives us sentence-ish cues, which is the right unit to
  // click on. Word-level would be far noisier to render.
  form.append("timestamp_granularities[]", "segment");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${s.openai_api_key}` },
    body: form,
  });
  if (!res.ok) return { error: whisperError(res.status, await res.text()) };

  const json = (await res.json()) as {
    language?: string;
    segments?: { start: number; end: number; text: string }[];
  };
  const cues = (json.segments ?? [])
    .map((seg) => ({
      start: Number(seg.start) || 0,
      end: Number(seg.end) || 0,
      text: (seg.text ?? "").trim(),
    }))
    .filter((c) => c.text.length > 0);

  return { language: json.language || "en", cues };
}
