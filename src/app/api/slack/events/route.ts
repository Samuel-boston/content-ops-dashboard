import { after } from "next/server";
import { postToSlack, slackSettings, verifySlackSignature } from "@/lib/integrations/slack";
import { handleSlackText } from "@/lib/slack-ops";

// Replying can involve the AI and a few queries; give it room.
export const maxDuration = 60;

interface SlackEvent {
  type: string;
  user?: string;
  text?: string;
  channel?: string;
  channel_type?: string;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
}

/**
 * Slack's Events API: a message that @-mentions the bot, or a direct message to
 * it. Slack wants an answer inside three seconds, so this verifies the request,
 * acknowledges straight away, and does the work after — the reply is posted back
 * into the same thread.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const settings = await slackSettings();
  if (!settings) return new Response("not configured", { status: 404 });

  // The one-off handshake when the request URL is saved in the Slack app.
  // It is signed like everything else, so it is verified first.
  const ok = verifySlackSignature({
    rawBody: raw,
    timestamp: req.headers.get("x-slack-request-timestamp"),
    signature: req.headers.get("x-slack-signature"),
    signingSecret: settings.signingSecret,
  });
  if (!ok) return new Response("bad signature", { status: 401 });

  let body: { type?: string; challenge?: string; event?: SlackEvent };
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (body.type === "url_verification") {
    return new Response(JSON.stringify({ challenge: body.challenge }), { headers: { "content-type": "application/json" } });
  }

  // Slack retries when it doesn't hear back in time; the first attempt is already working.
  if (req.headers.get("x-slack-retry-num")) return new Response("ok");

  const ev = body.event;
  if (!ev || ev.bot_id || ev.subtype || !ev.user || !ev.text || !ev.channel) return new Response("ok");
  const isMention = ev.type === "app_mention";
  const isDirect = ev.type === "message" && ev.channel_type === "im";
  if (!isMention && !isDirect) return new Response("ok");
  // Ignore anything the bot itself said.
  if (settings.botUserId && ev.user === settings.botUserId) return new Response("ok");

  const { user, text, channel } = ev;
  const threadTs = ev.thread_ts ?? ev.ts;
  after(async () => {
    const reply = await handleSlackText(text, user);
    await postToSlack({ channel, text: reply, threadTs: isDirect ? undefined : threadTs });
  });
  return new Response("ok");
}
