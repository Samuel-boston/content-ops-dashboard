import "server-only";

/**
 * Send a notification email via Resend (optional — no-op if not configured).
 *
 * `html` is optional: plain-text-only is right for a one-line notification,
 * and anything designed (the weekly digest) passes both so clients that
 * refuse HTML still get something readable.
 */
export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  html?: string
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) return { ok: false, error: "email not configured" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text, ...(html ? { html } : {}) }),
    });
    if (!res.ok) return { ok: false, error: `resend ${res.status}: ${await res.text()}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
