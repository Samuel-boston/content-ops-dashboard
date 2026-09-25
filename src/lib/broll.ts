/** Pure helpers for the B-roll section. No database, so they can be tested on their own. */

/** Category value that means "no category yet". */
export const NO_CATEGORY = "__none";

/** "04_Daily Rituals" reads as "Daily Rituals"; the number is only there to sort the folders. */
export const folderName = (raw: string) => raw.replace(/^\d+[_\s-]+/, "").trim() || raw;

/** Script text into the lines worth finding a clip for: one per line or sentence, timecodes and stage notes dropped. */
export function splitBeats(text: string): string[] {
  const beats: string[] = [];
  for (const raw of text.split(/\r?\n+/)) {
    const line = raw
      .replace(/^\s*[\[(]?\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?[\])]?\s*[-–—:]?\s*/, "")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!line) continue;
    const parts = line.length > 200 ? line.split(/(?<=[.!?])\s+/) : [line];
    for (const part of parts) if (part.trim().split(/\s+/).length >= 3) beats.push(part.trim());
  }
  return beats;
}
