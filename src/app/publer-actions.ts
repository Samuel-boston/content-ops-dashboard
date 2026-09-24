"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { getWorkspaceSettings } from "@/lib/workspace";
import { listAccounts, listWorkspaces, PublerError, type PublerCreds } from "@/lib/publer-client";

/**
 * Connecting Publer, in as few steps as it can be: paste one API key and press
 * Connect. Everything else — which workspace, which Instagram account — is read
 * from Publer and picked automatically when there's only one to pick.
 */

export interface PublerChoice {
  workspaceId: string;
  workspaceName: string;
  accountId: string;
  accountName: string;
}

export type PublerConnectResult =
  | { ok: true; connected: true; accountName: string }
  | { ok: true; connected: false; choices: PublerChoice[] }
  | { ok: false; message: string };

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

/** Every Instagram account the key can see, across its workspaces. */
async function findInstagramAccounts(apiKey: string): Promise<PublerChoice[]> {
  const workspaces = await listWorkspaces({ apiKey });
  const found: PublerChoice[] = [];
  for (const w of workspaces) {
    const creds: PublerCreds = { apiKey, workspaceId: w.id };
    const accounts = await listAccounts(creds);
    for (const a of accounts) {
      if (a.provider === "instagram") {
        found.push({ workspaceId: w.id, workspaceName: w.name, accountId: a.id, accountName: a.name });
      }
    }
  }
  return found;
}

export async function connectPublerAction(apiKey: string): Promise<PublerConnectResult> {
  await requireRole("owner");
  const key = apiKey.trim();
  if (!key || key.startsWith("••")) return { ok: false, message: "Paste the API key from Publer first." };
  let choices: PublerChoice[];
  try {
    choices = await findInstagramAccounts(key);
  } catch (e) {
    return { ok: false, message: e instanceof PublerError ? e.message : (e as Error).message };
  }
  if (choices.length === 0) {
    const err = await save({ publer_api_key: key, publer_workspace_id: null, publer_account_id: null, publer_account_name: null });
    if (err) return { ok: false, message: err };
    return {
      ok: false,
      message:
        "The key works, but no Instagram account is connected inside Publer yet. In Publer open Social Accounts → Add account → Instagram, then press Connect again.",
    };
  }
  if (choices.length === 1) {
    const c = choices[0];
    const err = await save({
      publer_api_key: key,
      publer_workspace_id: c.workspaceId,
      publer_account_id: c.accountId,
      publer_account_name: c.accountName,
    });
    if (err) return { ok: false, message: err };
    return { ok: true, connected: true, accountName: c.accountName };
  }
  // Several to choose from: keep the key, ask which.
  const err = await save({ publer_api_key: key, publer_workspace_id: null, publer_account_id: null, publer_account_name: null });
  if (err) return { ok: false, message: err };
  return { ok: true, connected: false, choices };
}

export async function choosePublerAccountAction(choice: {
  workspaceId: string;
  accountId: string;
}): Promise<PublerConnectResult> {
  await requireRole("owner");
  const s = await getWorkspaceSettings();
  if (!s.publer_api_key) return { ok: false, message: "Paste the API key and press Connect first." };
  try {
    const all = await findInstagramAccounts(s.publer_api_key);
    const hit = all.find((c) => c.workspaceId === choice.workspaceId && c.accountId === choice.accountId);
    if (!hit) return { ok: false, message: "That account isn't available any more. Press Connect again." };
    const err = await save({
      publer_workspace_id: hit.workspaceId,
      publer_account_id: hit.accountId,
      publer_account_name: hit.accountName,
    });
    if (err) return { ok: false, message: err };
    return { ok: true, connected: true, accountName: hit.accountName };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** A live check of what's saved: the key still works and the account is still there. */
export async function testPublerAction(): Promise<{ ok: boolean; message: string }> {
  await requireRole("owner");
  const s = await getWorkspaceSettings();
  if (!s.publer_api_key || !s.publer_workspace_id || !s.publer_account_id) {
    return { ok: false, message: "Publer isn't connected yet." };
  }
  try {
    const accounts = await listAccounts({ apiKey: s.publer_api_key, workspaceId: s.publer_workspace_id });
    const acc = accounts.find((a) => a.id === s.publer_account_id);
    if (!acc) return { ok: false, message: "The chosen Instagram account is no longer in Publer. Press Change account and pick it again." };
    return { ok: true, message: `Connected — ready to post to Instagram (${acc.name}).` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function setPublerTrialModeAction(mode: "MANUAL" | "SS_PERFORMANCE") {
  if (mode !== "MANUAL" && mode !== "SS_PERFORMANCE") return { error: "Unknown option." };
  const err = await save({ publer_trial_mode: mode });
  return err ? { error: err } : { ok: true };
}

export async function disconnectPublerAction() {
  const err = await save({
    publer_api_key: null,
    publer_workspace_id: null,
    publer_account_id: null,
    publer_account_name: null,
  });
  return err ? { error: err } : { ok: true };
}
