"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { getWorkspaceSettings, publerAccounts } from "@/lib/workspace";
import { listAccounts, listWorkspaces, PublerError, type PublerCreds } from "@/lib/publer-client";

/**
 * Connecting Publer, in as few steps as it can be: paste one API key and press
 * Connect. Everything else — which workspace, which Instagram account — is read
 * from Publer and picked automatically when there's only one to pick.
 */

export interface PublerAccountOption {
  network: string;
  accountId: string;
  accountName: string;
}

export interface PublerWorkspaceOption {
  workspaceId: string;
  workspaceName: string;
  accounts: PublerAccountOption[];
}

export type PublerConnectResult =
  | { ok: true; connected: true; summary: string }
  | { ok: true; connected: false; workspaces: PublerWorkspaceOption[] }
  | { ok: false; message: string };

/** The networks the dashboard posts to through Publer. */
const NETWORKS = ["instagram", "youtube", "tiktok", "linkedin"];

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

/** Every workspace the key can see that has at least one account we can post to. */
async function findAccounts(apiKey: string): Promise<PublerWorkspaceOption[]> {
  const workspaces = await listWorkspaces({ apiKey });
  const found: PublerWorkspaceOption[] = [];
  for (const w of workspaces) {
    const creds: PublerCreds = { apiKey, workspaceId: w.id };
    const accounts = (await listAccounts(creds))
      .filter((a) => NETWORKS.includes(a.provider))
      .map((a) => ({ network: a.provider, accountId: a.id, accountName: a.name }));
    if (accounts.length) found.push({ workspaceId: w.id, workspaceName: w.name, accounts });
  }
  return found;
}

function summarise(accounts: Record<string, { name: string }>): string {
  const label = (n: string) => n[0].toUpperCase() + n.slice(1);
  return Object.entries(accounts)
    .map(([n, a]) => `${label(n)}${a.name ? ` (${a.name})` : ""}`)
    .join(", ");
}

async function persist(apiKey: string | null, workspaceId: string, chosen: Record<string, PublerAccountOption>) {
  const accounts: Record<string, { id: string; name: string }> = {};
  for (const [network, a] of Object.entries(chosen)) accounts[network] = { id: a.accountId, name: a.accountName };
  const ig = accounts.instagram;
  return save({
    ...(apiKey ? { publer_api_key: apiKey } : {}),
    publer_workspace_id: workspaceId,
    publer_accounts: accounts,
    publer_account_id: ig?.id ?? null,
    publer_account_name: ig?.name ?? null,
  });
}

export async function connectPublerAction(apiKey: string): Promise<PublerConnectResult> {
  await requireRole("owner");
  const key = apiKey.trim();
  if (!key || key.startsWith("••")) return { ok: false, message: "Paste the API key from Publer first." };
  let workspaces: PublerWorkspaceOption[];
  try {
    workspaces = await findAccounts(key);
  } catch (e) {
    return { ok: false, message: e instanceof PublerError ? e.message : (e as Error).message };
  }
  if (workspaces.length === 0) {
    const err = await save({ publer_api_key: key, publer_workspace_id: null, publer_accounts: {}, publer_account_id: null, publer_account_name: null });
    if (err) return { ok: false, message: err };
    return {
      ok: false,
      message:
        "The key works, but no Instagram, YouTube, TikTok or LinkedIn account is connected inside Publer yet. In Publer open Social Accounts → Add account, then press Connect again.",
    };
  }
  // One workspace and at most one account per network: nothing to choose.
  if (workspaces.length === 1) {
    const only = workspaces[0];
    const byNetwork = new Map<string, PublerAccountOption[]>();
    for (const a of only.accounts) byNetwork.set(a.network, [...(byNetwork.get(a.network) ?? []), a]);
    if ([...byNetwork.values()].every((list) => list.length === 1)) {
      const chosen: Record<string, PublerAccountOption> = {};
      for (const [n, list] of byNetwork) chosen[n] = list[0];
      const err = await persist(key, only.workspaceId, chosen);
      if (err) return { ok: false, message: err };
      return { ok: true, connected: true, summary: summarise(Object.fromEntries(Object.entries(chosen).map(([n, a]) => [n, { name: a.accountName }]))) };
    }
  }
  // Something to choose: keep the key, ask which.
  const err = await save({ publer_api_key: key, publer_workspace_id: null, publer_accounts: {}, publer_account_id: null, publer_account_name: null });
  if (err) return { ok: false, message: err };
  return { ok: true, connected: false, workspaces };
}

/** Save the chosen workspace and one account per network. */
export async function choosePublerAccountsAction(input: {
  workspaceId: string;
  accounts: Record<string, string>;
}): Promise<PublerConnectResult> {
  await requireRole("owner");
  const s = await getWorkspaceSettings();
  if (!s.publer_api_key) return { ok: false, message: "Paste the API key and press Connect first." };
  try {
    const all = await findAccounts(s.publer_api_key);
    const ws = all.find((w) => w.workspaceId === input.workspaceId);
    if (!ws) return { ok: false, message: "That workspace isn't available any more. Press Connect again." };
    const chosen: Record<string, PublerAccountOption> = {};
    for (const [network, accountId] of Object.entries(input.accounts)) {
      if (!accountId) continue;
      const hit = ws.accounts.find((a) => a.network === network && a.accountId === accountId);
      if (hit) chosen[network] = hit;
    }
    if (!Object.keys(chosen).length) return { ok: false, message: "Pick at least one account to post to." };
    const err = await persist(null, ws.workspaceId, chosen);
    if (err) return { ok: false, message: err };
    return { ok: true, connected: true, summary: summarise(Object.fromEntries(Object.entries(chosen).map(([n, a]) => [n, { name: a.accountName }]))) };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** A live check of what's saved: the key still works and every chosen account is still there. */
export async function testPublerAction(): Promise<{ ok: boolean; message: string }> {
  await requireRole("owner");
  const s = await getWorkspaceSettings();
  const saved = publerAccounts(s);
  if (!s.publer_api_key || !s.publer_workspace_id || !Object.keys(saved).length) {
    return { ok: false, message: "Publer isn't connected yet." };
  }
  try {
    const live = await listAccounts({ apiKey: s.publer_api_key, workspaceId: s.publer_workspace_id });
    const gone = Object.entries(saved).filter(([, a]) => !live.some((l) => l.id === a.id)).map(([n]) => n);
    if (gone.length) return { ok: false, message: `Not in Publer any more: ${gone.join(", ")}. Press Change accounts and pick again.` };
    return { ok: true, message: `Connected — ready to post to ${summarise(saved)}.` };
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
    publer_accounts: {},
    publer_account_id: null,
    publer_account_name: null,
  });
  return err ? { error: err } : { ok: true };
}
