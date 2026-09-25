import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Who may run the scheduled jobs. Either credential works — the `?key=` an outside
 * scheduler sends, or the `Authorization: Bearer` header Vercel's own cron adds —
 * but both must equal CRON_SECRET, and if CRON_SECRET isn't set NOBODY is let in.
 * (It used to fail open: an unset secret meant anyone could trigger the jobs.)
 */
export function cronAuthorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const same = (given: string | null) => {
    if (!given) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  return same(new URL(req.url).searchParams.get("key")) || same((req.headers.get("authorization") ?? "").replace(/^Bearer /, "") || null);
}
