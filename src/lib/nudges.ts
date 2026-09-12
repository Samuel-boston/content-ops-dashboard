/**
 * Canned "chase it up" lines for the client.
 *
 * Lives here rather than in pipeline-actions.ts because that file is
 * `"use server"`, and such a file may only export async functions — exporting
 * this object from there crashed every component whose import chain reached it.
 */
export const NUDGES = {
  update: "Hey — any update on this one?",
  eta: "Could you pop an ETA on this when you get a sec?",
  blocked: "Anything blocking this? Happy to help if so.",
} as const;

export type NudgeKind = keyof typeof NUDGES;
