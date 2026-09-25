/**
 * Beats to ranked clip suggestions: the prompt for the reranking model, reading its answer, and
 * the rule that keeps one clip from carrying a whole script. Ported from the B-Roll Librarian's
 * matcher. Pure: the search and the model call live in the server action.
 *
 * Retrieval finds the candidates; a text model then reranks them, because the best B-roll for a
 * line of narration is usually not its most literal illustration. It is told to say "no good
 * match" rather than force one, and to explain each choice in a line. The gaps become a list of
 * footage to go and shoot.
 */

/** How much a clip's score is cut for each time it has already been used. */
export const REPEAT_PENALTY = 0.45;
export const SUGGESTIONS_PER_BEAT = 3;
export const CANDIDATES_PER_BEAT = 8;

export interface Candidate {
  caption: string | null;
  shotType: string | null;
  setting: string | null;
  action: string | null;
  emotions: string[];
  media: "video" | "image";
  durationS: number | null;
}

export const RERANK_SYSTEM = `You are a video editor choosing B-roll to cut under a line of narration.

You are given the narration and a numbered list of candidate clips, each with a caption and its facets. Choose the best ${SUGGESTIONS_PER_BEAT} in order.

What matters:
- The literal match is often the wrong answer. Narration about "slowing down" wants a calm, slow-paced visual, not necessarily a clock. Narration about "growth" rarely wants a chart.
- Prefer clips whose mood and pace match the tone of the line.
- Prefer clips long enough to cover the beat, but do not reject a good shot just for being short. A still photograph can hold any length, but it is a static image on screen, so choose one only when it genuinely suits the line.
- Give one line of reason per choice, addressed to the editor.
- If none of the candidates genuinely works, set no_good_match and say in missing_footage what should be shot instead. An honest gap is more useful than a forced match.
- Not every line needs B-roll. Set needs_broll to false when the line is best left on the speaker: a short filler or connective line, a direct address to the viewer, an emotional beat that lands on the face, or a line where a cutaway would only distract. Say why in no_broll_reason. Still list your best choices in case the editor overrules you, unless nothing is close.

Reply with only JSON in this shape:
{"needs_broll":true,"no_broll_reason":null,"choices":[{"candidate":1,"reason":"one line","confidence":0.8}],"no_good_match":false,"missing_footage":null}
"candidate" is the 1-based number from the list. "confidence" is between 0 and 1.`;

export function rerankUserPrompt(beat: { index: number; startS: number; endS: number; text: string }, candidates: Candidate[]): string {
  const lines = [`NARRATION (beat ${beat.index + 1}, ${Math.max(0, beat.endS - beat.startS).toFixed(1)}s):`, beat.text, "", "CANDIDATES:"];
  candidates.forEach((c, i) => {
    const facets = [c.shotType, c.setting, c.action].filter(Boolean).join(", ");
    const mood = c.emotions.length ? `mood: ${c.emotions.join(", ")}` : "";
    const length = c.media === "image" ? "still photograph" : c.durationS ? `${c.durationS.toFixed(1)}s` : "";
    const detail = [facets, mood, length].filter(Boolean).join("; ");
    lines.push(`${i + 1}. ${c.caption || "no caption"} [${detail}]`);
  });
  return lines.join("\n");
}

export interface RerankReading {
  /** False when the model says this line is best left on the speaker. */
  needsBroll: boolean;
  noBrollReason: string | null;
  choices: { index: number; reason: string; confidence: number }[];
  noGoodMatch: boolean;
  missing: string | null;
}

/** Read the model's JSON defensively: bad numbers are dropped, duplicates ignored, confidence clamped. */
export function readRerank(raw: unknown, candidateCount: number): RerankReading | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { choices?: unknown; no_good_match?: unknown; missing_footage?: unknown; needs_broll?: unknown; no_broll_reason?: unknown };
  const seen = new Set<number>();
  const choices: RerankReading["choices"] = [];
  for (const c of Array.isArray(o.choices) ? o.choices : []) {
    const cc = c as { candidate?: unknown; reason?: unknown; confidence?: unknown };
    const n = Number(cc.candidate);
    if (!Number.isInteger(n) || n < 1 || n > candidateCount || seen.has(n)) continue;
    seen.add(n);
    const conf = Number(cc.confidence);
    choices.push({
      index: n - 1,
      reason: typeof cc.reason === "string" ? cc.reason.trim().slice(0, 240) : "",
      confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.5,
    });
  }
  return {
    needsBroll: o.needs_broll !== false,
    noBrollReason: typeof o.no_broll_reason === "string" && o.no_broll_reason.trim() ? o.no_broll_reason.trim().slice(0, 240) : null,
    choices: choices.slice(0, SUGGESTIONS_PER_BEAT),
    noGoodMatch: o.no_good_match === true,
    missing: typeof o.missing_footage === "string" && o.missing_footage.trim() ? o.missing_footage.trim().slice(0, 300) : null,
  };
}

export interface Ranked<T> {
  item: T;
  reason: string;
  confidence: number;
  reused: boolean;
}

/**
 * Order one beat's candidates: the model's picks first, in its order, then the rest in search order.
 * A clip already used elsewhere is pushed down (never removed), so the same clip doesn't carry five
 * beats. Without a reading (no key, or the model failed) it is plain search order.
 */
export function orderCandidates<T extends { id: string }>(
  candidates: T[],
  reading: RerankReading | null,
  used: Record<string, number>
): Ranked<T>[] {
  type Scored = Ranked<T> & { score: number };
  const picked = new Set<number>();
  const scored: Scored[] = [];
  const push = (i: number, base: number, reason: string, confidence: number) => {
    const n = used[candidates[i].id] ?? 0;
    scored.push({ item: candidates[i], reason, confidence, reused: n > 0, score: base * REPEAT_PENALTY ** n });
  };
  if (reading) {
    reading.choices.forEach((c, pos) => {
      picked.add(c.index);
      push(c.index, 1 / (pos + 1), c.reason, c.confidence);
    });
  }
  candidates.forEach((_, i) => {
    if (picked.has(i)) return;
    // Model picks always outrank the leftovers; leftovers keep search order.
    push(i, (reading ? 0.1 : 1) / (i + 1), reading ? "" : "Ranked by search.", reading ? 0 : 0.4);
  });
  return scored.sort((a, b) => b.score - a.score).map(({ item, reason, confidence, reused }) => ({ item, reason, confidence, reused }));
}
