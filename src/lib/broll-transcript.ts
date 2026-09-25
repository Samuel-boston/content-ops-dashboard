/**
 * Transcript parsing and beat segmentation, ported from the B-Roll Librarian.
 *
 * SRT and VTT carry real timecodes. Plain text does not, so timings are estimated from a
 * reading speed (default 150 words a minute) and flagged as estimated. A beat is a coherent
 * 3 to 15 second span of narration: the unit an editor cuts a single piece of B-roll against.
 * Sentences are the natural boundary; long ones are divided and short ones merged to land in
 * that window.
 */

export interface Cue {
  startS: number;
  endS: number;
  text: string;
}

export interface Beat {
  index: number;
  startS: number;
  endS: number;
  text: string;
  estimated: boolean;
}

export const beatDuration = (b: { startS: number; endS: number }) => Math.max(0, b.endS - b.startS);

const SRT_TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
const SENTENCE_END = /(?<=[.!?])\s+(?=[A-Z0-9"'(])/;
const TAG = /<\/?[^>]+>/g;
const SPEAKER = /^\s*[A-Z][A-Za-z .'-]{0,24}:\s*/;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const clean = (t: string) => t.replace(TAG, "").replace(SPEAKER, "").replace(/\s+/g, " ").trim();
const toSeconds = (h: string, m: string, s: string, ms: string) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;

export function parseSrt(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.trim().split(/\n\s*\n/)) {
    const lines = block.split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) continue;
    let match: RegExpExecArray | null = null;
    let bodyStart = 0;
    for (let i = 0; i < Math.min(3, lines.length); i++) {
      match = SRT_TIME.exec(lines[i]);
      if (match) {
        bodyStart = i + 1;
        break;
      }
    }
    if (!match) continue;
    const body = clean(lines.slice(bodyStart).join(" "));
    if (!body) continue;
    cues.push({
      startS: toSeconds(match[1], match[2], match[3], match[4]),
      endS: toSeconds(match[5], match[6], match[7], match[8]),
      text: body,
    });
  }
  return cues;
}

export function parseVtt(text: string): Cue[] {
  const body = text
    .replace(/^\s*WEBVTT[\s\S]*?(\n\n|$)/, "")
    .replace(/^\s*(NOTE|STYLE|REGION)\b[\s\S]*?(\n\n|$)/gm, "");
  return parseSrt(body);
}

/** No timecodes, so estimate them from a reading speed. A line break also ends a sentence: a script is usually one beat per line. */
export function parsePlainText(text: string, wordsPerMinute = 150): Cue[] {
  const perWord = 60 / Math.max(1, wordsPerMinute);
  const cues: Cue[] = [];
  let cursor = 0;
  const prepared = text.replace(/\[[^\]]*\]/g, " "); // [B-ROLL], [pause] and other stage notes
  for (const line of prepared.split(/\r?\n+/)) {
    for (const sentence of line.split(SENTENCE_END)) {
      const cleaned = clean(sentence);
      if (!cleaned) continue;
      const duration = Math.max(1, words(cleaned) * perWord);
      cues.push({ startS: cursor, endS: cursor + duration, text: cleaned });
      cursor += duration;
    }
  }
  return cues;
}

/** Returns the cues and whether their timings were estimated. */
export function parseTranscript(text: string, filename?: string, wordsPerMinute = 150): { cues: Cue[]; estimated: boolean } {
  const ext = filename ? filename.toLowerCase().slice(filename.lastIndexOf(".")) : "";
  const head = text.trim();
  if (ext === ".vtt" || head.toUpperCase().startsWith("WEBVTT")) return { cues: parseVtt(text), estimated: false };
  if (ext === ".srt" || SRT_TIME.test(head.slice(0, 2000))) {
    const cues = parseSrt(text);
    if (cues.length) return { cues, estimated: false };
  }
  return { cues: parsePlainText(text, wordsPerMinute), estimated: true };
}

/** Re-cut cues on sentence boundaries, interpolating times by word count. */
function sentences(cues: Cue[]): Cue[] {
  const out: Cue[] = [];
  for (const cue of cues) {
    const parts = cue.text.split(SENTENCE_END).map((p) => p.trim()).filter(Boolean);
    if (parts.length <= 1) {
      out.push(cue);
      continue;
    }
    const total = parts.reduce((n, p) => n + words(p), 0) || 1;
    const span = cue.endS - cue.startS;
    let cursor = cue.startS;
    for (const part of parts) {
      const share = span * (words(part) / total);
      out.push({ startS: cursor, endS: cursor + share, text: part });
      cursor += share;
    }
  }
  return out;
}

function mergeShort(cues: Cue[], min: number, max: number): Cue[] {
  const merged: Cue[] = [];
  for (const cue of cues) {
    const prev = merged[merged.length - 1];
    if (prev && prev.endS - prev.startS < min && cue.endS - prev.startS <= max) {
      merged[merged.length - 1] = { startS: prev.startS, endS: cue.endS, text: `${prev.text} ${cue.text}` };
      continue;
    }
    merged.push(cue);
  }
  // A trailing runt has no successor to absorb it; fold it backwards.
  if (merged.length > 1 && merged[merged.length - 1].endS - merged[merged.length - 1].startS < min) {
    const last = merged.pop()!;
    const prev = merged[merged.length - 1];
    merged[merged.length - 1] = { startS: prev.startS, endS: last.endS, text: `${prev.text} ${last.text}` };
  }
  return merged;
}

function divideLong(cue: Cue, max: number): Cue[] {
  const span = cue.endS - cue.startS;
  if (span <= max) return [cue];
  const pieces = Math.floor(span / max) + 1;
  const ws = cue.text.split(/\s+/).filter(Boolean);
  const per = Math.max(1, Math.floor(ws.length / pieces));
  const out: Cue[] = [];
  let cursor = cue.startS;
  for (let i = 0; i < pieces; i++) {
    const chunk = ws.slice(i * per, i === pieces - 1 ? undefined : (i + 1) * per);
    if (!chunk.length) continue;
    const share = span * (chunk.length / ws.length);
    out.push({ startS: cursor, endS: cursor + share, text: chunk.join(" ") });
    cursor += share;
  }
  return out.length ? out : [cue];
}

export function segment(cues: Cue[], estimated: boolean, min = 3, max = 15): Beat[] {
  const divided = mergeShort(sentences(cues), min, max).flatMap((c) => divideLong(c, max));
  return divided.map((c, index) => ({
    index,
    startS: Math.round(c.startS * 1000) / 1000,
    endS: Math.round(c.endS * 1000) / 1000,
    text: c.text,
    estimated,
  }));
}

export function beatsFromText(text: string, filename?: string, wordsPerMinute = 150): Beat[] {
  const { cues, estimated } = parseTranscript(text, filename, wordsPerMinute);
  return segment(cues, estimated);
}

/** `1:05` style, for showing a beat's place in the script. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
