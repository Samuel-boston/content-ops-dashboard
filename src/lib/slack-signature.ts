import crypto from "node:crypto";

/**
 * Slack signs every request it sends (HMAC-SHA256 over `v0:timestamp:body`).
 * Anything that doesn't verify is not from Slack and is dropped. Requests more
 * than five minutes old are refused so a captured one can't be replayed.
 */
export function verifySlackSignature(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  signingSecret: string;
  now?: number;
}): boolean {
  const { rawBody, timestamp, signature, signingSecret } = input;
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 60 * 5) return false;
  const expected = "v0=" + crypto.createHmac("sha256", signingSecret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
