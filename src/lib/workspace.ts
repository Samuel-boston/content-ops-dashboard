import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { IntegrationStatus, PublishChannel, WorkspaceSettings } from "@/lib/types";

/**
 * Workspace-level integration config. Stored in one DB row (Owner-only via RLS)
 * so the eventual move to the client's own Cloudflare / Meta / Telegram / Drive
 * accounts is a settings edit — not a redeploy. Read here with the service-role
 * client because webhooks and cron have no user session.
 */
export const getWorkspaceSettings = cache(async (): Promise<WorkspaceSettings> => {
  const db = supabaseAdmin();
  const { data } = await db.from("workspace_settings").select("*").eq("id", 1).single();
  return (data as WorkspaceSettings) ?? emptySettings();
});

function emptySettings(): WorkspaceSettings {
  return {
    id: 1,
    cf_account_id: null,
    cf_stream_token: null,
    cf_stream_customer_code: null,
    drive_folder_id: null,
    drive_service_account: null,
    ig_user_id: null,
    ig_access_token: null,
    ig_token_expires_at: null,
    publer_api_key: null,
    publer_workspace_id: null,
    publer_account_id: null,
    publer_account_name: null,
    publer_accounts: {},
    publer_trial_mode: "MANUAL",
    telegram_bot_token: null,
    telegram_chat_ids: [],
    telegram_user_ids: [],
    openai_api_key: null,
    groq_api_key: null,
    ai_provider: "groq",
    anthropic_api_key: null,
    hook_variant_surcharge_cents: 200,
    currency: "USD",
    brand_name: null,
    client_name: null,
    brand_logo_path: null,
    updated_by: null,
    updated_at: new Date(0).toISOString(),
  };
}

/** Publer accounts by network, including an Instagram account saved before migration 048. */
export function publerAccounts(s: WorkspaceSettings): Record<string, { id: string; name: string }> {
  const out = { ...(s.publer_accounts ?? {}) };
  if (!out.instagram && s.publer_account_id) out.instagram = { id: s.publer_account_id, name: s.publer_account_name ?? "" };
  return out;
}

const POSTABLE: PublishChannel[] = ["instagram", "youtube", "tiktok", "linkedin"];

/** Where a post can actually go today: the Graph API for Instagram, or any account connected in Publer. */
export function postingChannels(s: WorkspaceSettings): PublishChannel[] {
  const viaPubler = s.publer_api_key && s.publer_workspace_id ? Object.keys(publerAccounts(s)) : [];
  return POSTABLE.filter(
    (c) => viaPubler.includes(c) || (c === "instagram" && Boolean(s.ig_user_id && s.ig_access_token))
  );
}

export function integrationStatus(s: WorkspaceSettings): IntegrationStatus {
  return {
    stream: Boolean(s.cf_account_id && s.cf_stream_token && s.cf_stream_customer_code),
    drive: Boolean(s.drive_folder_id && s.drive_service_account),
    instagram: Boolean(s.ig_user_id && s.ig_access_token),
    publer: Boolean(s.publer_api_key && s.publer_workspace_id && Object.keys(publerAccounts(s)).length > 0),
    channels: postingChannels(s),
    telegram: Boolean(s.telegram_bot_token && s.telegram_chat_ids.length),
    whisper: Boolean(s.openai_api_key),
    ai:
      s.ai_provider === "anthropic"
        ? Boolean(s.anthropic_api_key)
        : s.ai_provider === "openai"
          ? Boolean(s.openai_api_key)
          : Boolean(s.groq_api_key),
    email: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
  };
}

/** Redact secrets before sending settings to the client settings form. */
export function redactSettings(s: WorkspaceSettings) {
  const mask = (v: string | null) => (v ? "••••••••" + v.slice(-4) : null);
  return {
    ...s,
    cf_stream_token: mask(s.cf_stream_token),
    ig_access_token: mask(s.ig_access_token),
    publer_api_key: mask(s.publer_api_key),
    telegram_bot_token: mask(s.telegram_bot_token),
    openai_api_key: mask(s.openai_api_key),
    groq_api_key: mask(s.groq_api_key),
    anthropic_api_key: mask(s.anthropic_api_key),
    drive_service_account: s.drive_service_account ? "•••• configured ••••" : null,
  };
}

export interface Branding {
  name: string;
  logoUrl: string | null;
}

/**
 * The client's name and logo for the nav.
 *
 * The `branding` bucket is public, so the logo URL is built by string rather
 * than signed — a signed URL would expire and buy nothing, since a logo is
 * the least secret thing in the workspace.
 */
export const brandingFor = unstable_cache(
  async (): Promise<Branding> => {
    const s = await getWorkspaceSettings();
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
    return {
      name: s.brand_name?.trim() || "Content Ops",
      logoUrl:
        s.brand_logo_path && base
          ? `${base}/storage/v1/object/public/branding/${s.brand_logo_path}`
          : null,
    };
  },
  ["branding"],
  // Cached across requests, not just within one: the nav reads this on every
  // navigation, and it is workspace-wide config that changes about never.
  // Sixty seconds is short enough that changing the logo feels immediate.
  { revalidate: 60, tags: ["branding"] }
);

/**
 * The client's first name, for copy aimed at editors ("Adam is reviewing").
 * Read with the service role — an editor can't see the owner's row through
 * RLS on every path — and cached, since it changes roughly never. Falls back
 * to "the client" until the owner has set a name.
 */
export const getClientName = unstable_cache(
  async (): Promise<string> => {
    // The name set in Settings -> Branding wins; the owner's own first name is
    // only a fallback for a workspace that hasn't set one.
    const s = await getWorkspaceSettings();
    const set = s.client_name?.trim();
    if (set) return set;
    const { data } = await supabaseAdmin()
      .from("profiles")
      .select("full_name")
      .eq("role", "owner")
      .eq("active", true)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    const first = (data?.full_name as string | null)?.trim().split(/\s+/)[0];
    return first || "the client";
  },
  ["client-first-name"],
  { revalidate: 300, tags: ["branding"] }
);
