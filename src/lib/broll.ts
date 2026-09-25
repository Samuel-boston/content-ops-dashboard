/** Pure helpers for the B-roll section. No database, so they can be tested on their own. */

/** Category value that means "no category yet". */
export const NO_CATEGORY = "__none";

/** "04_Daily Rituals" reads as "Daily Rituals"; the number is only there to sort the folders. */
export const folderName = (raw: string) => raw.replace(/^\d+[_\s-]+/, "").trim() || raw;
