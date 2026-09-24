"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { getWorkspaceSettings } from "@/lib/workspace";
import { explainSlackError, slackCall } from "@/lib/integrations/slack";

/**
 * Connecting Slack: create the app from the manifest shown in Settings, install it,
 * paste the two values it gives you, pick a channel. Nothing else to configure.
 */

async function save(patch: Record<string, unknown>) {
  const me = await requireRole("owner");
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("workspace_settings")
    .update({ ...patch, updated_by: me.id, updated_at: new Date().toISOString() })
    .eq("id", 1);
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return error?.message ?? null;
}

export async function connectSlackAction(input: { botToken: string; signingSecret: string }): Promise<
  { ok: true; team: string } | { ok: false; message: string }
> {
  await requireRole("owner");
  const token = input.botToken.trim();
  const secret = input.signingSecret.trim();
  if (!token.startsWith("xoxb-")) return { ok: false, message: "That doesn't look like a Bot User OAuth Token. It starts with xoxb-. Find it under OAuth & Permissions after you install the app." };
  if (secret.length < 16) return { ok: false, message: "Paste the Signing Secret from the app's Basic Information page." };

  const auth = await slackCall<{ team?: string; user_id?: string }>(token, "auth.test");
  if (!auth.ok) return { ok: false, message: explainSlackError(auth.error) };

  const err = await save({
    slack_bot_token: token,
    slack_signing_secret: secret,
    slack_bot_user_id: auth.data?.user_id ?? null,
    slack_team_name: auth.data?.team ?? null,
  });
  if (err) return { ok: false, message: err };
  return { ok: true, team: auth.data?.team ?? "your workspace" };
}

export async function listSlackChannelsAction(): Promise<{ id: string; name: string }[]> {
  await requireRole("owner");
  const s = await getWorkspaceSettings();
  if (!s.slack_bot_token) return [];
  const res = await slackCall<{ channels?: { id: string; name: string; is_archived?: boolean }[] }>(s.slack_bot_token, "conversations.list", {
    types: "public_channel",
    exclude_archived: true,
    limit: 200,
  });
  return (res.data?.channels ?? []).map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Choose where the dashboard announces things, and join it so it can post. */
export async function setSlackChannelAction(input: { id: string; name: string }): Promise<{ ok: boolean; message: string }> {
  await requireRole("owner");
  const s = await getWorkspaceSettings();
  if (!s.slack_bot_token) return { ok: false, message: "Connect Slack first." };
  const join = await slackCall(s.slack_bot_token, "conversations.join", { channel: input.id });
  const err = await save({ slack_channel_id: input.id, slack_channel_name: input.name });
  if (err) return { ok: false, message: err };
  return join.ok || join.error === "already_in_channel"
    ? { ok: true, message: `Announcing in #${input.name}.` }
    : { ok: true, message: `Saved #${input.name}, but the bot couldn't join it (${explainSlackError(join.error)})` };
}

export async function testSlackAction(): Promise<{ ok: boolean; message: string }> {
  await requireRole("owner");
  const s = await getWorkspaceSettings();
  if (!s.slack_bot_token) return { ok: false, message: "Slack isn't connected yet." };
  const auth = await slackCall(s.slack_bot_token, "auth.test");
  if (!auth.ok) return { ok: false, message: explainSlackError(auth.error) };
  if (!s.slack_channel_id) return { ok: true, message: "The token works. Pick a channel to send a test message." };
  let res = await slackCall(s.slack_bot_token, "chat.postMessage", {
    channel: s.slack_channel_id,
    text: "👋 Content Ops is connected. Try `/ops how many in scripting` or `/ops add idea: …`.",
  });
  if (!res.ok && res.error === "not_in_channel") {
    await slackCall(s.slack_bot_token, "conversations.join", { channel: s.slack_channel_id });
    res = await slackCall(s.slack_bot_token, "chat.postMessage", { channel: s.slack_channel_id, text: "👋 Content Ops is connected." });
  }
  return res.ok
    ? { ok: true, message: `Sent a test message to #${s.slack_channel_name ?? "the channel"}.` }
    : { ok: false, message: explainSlackError(res.error) };
}

export async function setSlackAnnounceAction(on: boolean) {
  const err = await save({ slack_announce: Boolean(on) });
  return err ? { error: err } : { ok: true as const };
}

export async function disconnectSlackAction() {
  const err = await save({
    slack_bot_token: null,
    slack_signing_secret: null,
    slack_bot_user_id: null,
    slack_team_name: null,
    slack_channel_id: null,
    slack_channel_name: null,
  });
  return err ? { error: err } : { ok: true as const };
}
