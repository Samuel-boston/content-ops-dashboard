import type { EditorRate, Video } from "@/lib/types";

/**
 * A forecast of what a video will be worth, mirroring the `video_price()`
 * function in the database.
 *
 * This is only ever used to estimate work that hasn't posted yet. The moment a
 * video posts, a trigger snapshots the real figure into `price_cents`, and
 * that snapshot always wins — a rate change months later must never rewrite
 * what someone was already paid. So: read `price_cents` if it exists, and only
 * fall back to this when it doesn't.
 *
 * One deliberate difference from the SQL: that version counts hook *cuts* that
 * actually exist, because at posting time they do. Here nothing has been cut
 * yet, so the count comes from the script's hooks — an intent rather than a
 * delivery, which is exactly what a forecast should be.
 */
export function videoPriceCents(
  video: Pick<Video, "assigned_editor_id" | "formats" | "script_hooks" | "variants_override">,
  rates: EditorRate[],
  surchargeCents: number
): number {
  if (!video.assigned_editor_id) return 0;

  // Highest-priced matching format, same tie-break as the SQL.
  const base = rates
    .filter((r) => video.formats?.includes(r.format))
    .reduce((best, r) => Math.max(best, r.price_cents), 0);

  // `variants_override === false` means the client has said this one doesn't
  // need variants, whatever the script says.
  const hooks = video.variants_override === false ? 1 : video.script_hooks?.length ?? 0;
  const extra = Math.max(hooks - 1, 0);

  return base + extra * surchargeCents;
}
