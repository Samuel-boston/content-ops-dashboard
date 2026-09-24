import type { TrialStatus } from "@/lib/types";

/**
 * Where a hook variant is in its life, in the words the team uses.
 *
 * Everything is posted as a trial reel first; the one that does best is then
 * posted to the main feed. Underneath that is two columns — `status` and
 * `post_as` — and this is the one place that turns them into a sentence.
 */
export interface VariantLike {
  status: TrialStatus;
  post_as: "trial" | "main" | "none" | null;
}

/** Live on the main feed: posted there directly, or promoted from a trial. */
export function isOnMainFeed(t: VariantLike): boolean {
  return t.status === "promoted" || (t.status === "posted" && t.post_as === "main");
}

export type VariantChoice = "trial" | "main" | "posted_main";

/** What the destination dropdown shows for this variant right now. */
export function variantChoice(t: VariantLike): VariantChoice {
  if (isOnMainFeed(t)) return "posted_main";
  return t.post_as === "main" ? "main" : "trial";
}

export const CHOICE_LABELS: Record<VariantChoice, string> = {
  trial: "Trial reel",
  main: "Main feed",
  posted_main: "Posted to main feed",
};

/** One short label for the state chip. */
export function variantStateLabel(t: VariantLike & { sentToVa?: boolean }): string {
  if (isOnMainFeed(t)) return "On main feed";
  if (t.status === "posted") return "Posted as trial";
  if (t.status === "archived") return "Archived";
  return "To post";
}
