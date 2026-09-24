import type { TrialStatus } from "@/lib/types";

/**
 * Where a hook variant is, in the words the team uses. Everything is posted as a
 * trial reel first; the one that performs best is then posted to the feed. Under
 * the hood it's two columns (`status` and `post_as`) and a timestamp — this file
 * is the one place that turns them into a single state, so every screen agrees.
 *
 *   to_trial        waiting to be posted as a trial reel
 *   trial_posted    live as a trial reel — numbers get typed in by hand
 *   to_feed         waiting to be posted to the main feed
 *   scheduled_feed  handed to Instagram's scheduler for the main feed
 *   feed_posted     live on the main feed — numbers come from Instagram
 */
export type VariantState = "to_trial" | "trial_posted" | "to_feed" | "scheduled_feed" | "feed_posted";

export interface VariantLike {
  status: TrialStatus;
  post_as: "trial" | "main" | "none" | null;
  posted_at?: string | null;
}

export function variantState(t: VariantLike): VariantState {
  if (t.status === "promoted") return t.posted_at ? "feed_posted" : "scheduled_feed";
  if (t.status === "posted") return t.post_as === "main" ? "feed_posted" : "trial_posted";
  return t.post_as === "main" ? "to_feed" : "to_trial";
}

export const STATE_LABELS: Record<VariantState, string> = {
  to_trial: "To post as trial",
  trial_posted: "Posted as trial reel",
  to_feed: "To post to feed",
  scheduled_feed: "Scheduled for feed",
  feed_posted: "Posted on feed",
};

/** Tailwind classes for the state chip. */
export const STATE_TONE: Record<VariantState, string> = {
  to_trial: "bg-amber-500/15 text-amber-400",
  trial_posted: "bg-emerald-500/15 text-emerald-400",
  to_feed: "bg-violet-500/15 text-violet-300",
  scheduled_feed: "bg-sky-500/15 text-sky-400",
  feed_posted: "bg-sky-500/20 text-sky-300",
};

/** The states a person can pick by hand. "Scheduled" is only ever the result of scheduling. */
export const SETTABLE_STATES: VariantState[] = ["to_trial", "trial_posted", "to_feed", "feed_posted"];

export const isToPost = (s: VariantState) => s === "to_trial" || s === "to_feed";
export const isOnMainFeed = (t: VariantLike) => variantState(t) === "feed_posted";
