import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Short-lived, signed links for "send this variant to my phone".
 *
 * The VA posts trial reels by hand from the Instagram app on a phone, so the
 * file has to get there: a QR code on the desktop opens a page on the phone
 * with the download and the caption. The link carries which variant and when
 * it expires, signed with the server's secret — nothing is stored, and it
 * can't be edited into pointing at a different video.
 */

const TTL_MS = 6 * 60 * 60 * 1000;

const b64 = (b: Buffer) => b.toString("base64url");
const sign = (payload: string) =>
  b64(createHmac("sha256", env.supabaseServiceRoleKey()).update(payload).digest());

export function mintPhoneToken(trialId: string): string {
  const payload = b64(Buffer.from(JSON.stringify({ t: trialId, e: Date.now() + TTL_MS })));
  return `${payload}.${sign(payload)}`;
}

export function readPhoneToken(token: string): string | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { t, e } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { t: string; e: number };
    return typeof t === "string" && typeof e === "number" && e > Date.now() ? t : null;
  } catch {
    return null;
  }
}

/**
 * A token for one cut version's original file — for places that can't send a
 * login: the phone page's Download button, and Instagram, which has to fetch
 * the video from a public address.
 */
export function mintFileToken(versionId: string, ttlMs = TTL_MS): string {
  const payload = b64(Buffer.from(JSON.stringify({ v: versionId, e: Date.now() + ttlMs })));
  return `${payload}.${sign(payload)}`;
}

export function readFileToken(token: string): string | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { v, e } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { v?: string; e: number };
    return typeof v === "string" && typeof e === "number" && e > Date.now() ? v : null;
  } catch {
    return null;
  }
}
