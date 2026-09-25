import { after } from "next/server";
import { slackSettings, verifySlackSignature } from "@/lib/integrations/slack";
import { handleSlackText } from "@/lib/slack-ops";

export const maxDuration = 60;

/**
 * The /ops slash command. Same rule as the events route: verify, acknowledge
 * inside Slack's three seconds, do the work after, and answer through the
 * command's response_url — as a reply only the person who asked can see, unless
 * it's an idea being added (that one everyone in the channel should see).
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const settings = await slackSettings();
  if (!settings) return new Response("not configured", { status: 404 });

  const ok = verifySlackSignature({
    rawBody: raw,
    timestamp: req.headers.get("x-slack-request-timestamp"),
    signature: req.headers.get("x-slack-signature"),
    signingSecret: settings.signingSecret,
  });
  if (!ok) return new Response("bad signature", { status: 401 });

  const form = new URLSearchParams(raw);
  const text = form.get("text") ?? "";
  const userId = form.get("user_id") ?? "";
  const responseUrl = form.get("response_url");
  // Answers only ever go back to Slack itself.
  if (!userId || !responseUrl || !/^https:\/\/hooks\.slack\.com\//.test(responseUrl)) return new Response("bad request", { status: 400 });

  after(async () => {
    const reply = await handleSlackText(text, userId);
    const shared = /^💡/.test(reply) || /^✅/.test(reply);
    await fetch(responseUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ response_type: shared ? "in_channel" : "ephemeral", text: reply }),
    }).catch(() => undefined);
  });
  // An empty 200 tells Slack "got it"; the real answer follows.
  return new Response(null, { status: 200 });
}
