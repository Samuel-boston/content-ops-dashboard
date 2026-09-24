import "server-only";
import { getWorkspaceSettings } from "@/lib/workspace";

const API = "https://slack.com/api";

/** Saved Slack settings, or null when Slack isn't connected. */
export async function slackSettings() {
  const s = await getWorkspaceSettings();
  if (!s.slack_bot_token || !s.slack_signing_secret) return null;
  return {
    token: s.slack_bot_token,
    signingSecret: s.slack_signing_secret,
    botUserId: s.slack_bot_user_id,
    channelId: s.slack_channel_id,
    announce: s.slack_announce,
  };
}

export { verifySlackSignature } from "@/lib/slack-signature";

export interface SlackResult<T = Record<string, unknown>> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** Call a Slack Web API method with the given bot token. */
export async function slackCall<T = Record<string, unknown>>(
  token: string,
  method: string,
  params: Record<string, unknown> = {}
): Promise<SlackResult<T>> {
  try {
    const res = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(params),
    });
    const body = (await res.json()) as { ok: boolean; error?: string } & T;
    return body.ok ? { ok: true, data: body } : { ok: false, error: body.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Plain-English versions of the Slack errors a person can actually fix. */
export function explainSlackError(error: string | undefined): string {
  switch (error) {
    case "invalid_auth":
    case "not_authed":
    case "token_revoked":
    case "account_inactive":
      return "Slack didn't accept that token. Copy the Bot User OAuth Token again (it starts with xoxb-).";
    case "missing_scope":
      return "The Slack app is missing a permission. Recreate it from the manifest in this card, then reinstall it.";
    case "channel_not_found":
      return "Slack can't see that channel. Invite the bot to it (type /invite @Content Ops in the channel) or pick a public one.";
    case "not_in_channel":
      return "The bot isn't in that channel yet. Type /invite @Content Ops in it, then try again.";
    case "is_archived":
      return "That channel is archived.";
    default:
      return `Slack said: ${error ?? "something went wrong"}`;
  }
}

/** Post a message. Best-effort callers should catch nothing: this never throws. */
export async function postToSlack(input: { channel: string; text: string; threadTs?: string }): Promise<SlackResult> {
  const s = await slackSettings();
  if (!s) return { ok: false, error: "not_configured" };
  const res = await slackCall(s.token, "chat.postMessage", {
    channel: input.channel,
    text: input.text,
    thread_ts: input.threadTs,
    unfurl_links: false,
    mrkdwn: true,
  });
  // A public channel the bot hasn't joined: join it once and retry.
  if (!res.ok && res.error === "not_in_channel") {
    await slackCall(s.token, "conversations.join", { channel: input.channel });
    return slackCall(s.token, "chat.postMessage", { channel: input.channel, text: input.text, thread_ts: input.threadTs, unfurl_links: false, mrkdwn: true });
  }
  return res;
}

/**
 * Tell the team's channel something happened. Silent when Slack isn't connected,
 * no channel is chosen, or announcements are switched off — the dashboard never
 * fails because Slack did.
 */
export async function announceSlack(text: string): Promise<void> {
  try {
    const s = await slackSettings();
    if (!s || !s.announce || !s.channelId) return;
    await postToSlack({ channel: s.channelId, text });
  } catch {
    /* Slack is a nicety; a failure here must not touch the caller */
  }
}

/** The email address on a Slack user (needs the users:read.email scope). */
export async function slackUserEmail(userId: string): Promise<string | null> {
  const s = await slackSettings();
  if (!s) return null;
  const res = await slackCall<{ user?: { profile?: { email?: string } } }>(s.token, "users.info", { user: userId });
  return res.data?.user?.profile?.email?.toLowerCase() ?? null;
}
