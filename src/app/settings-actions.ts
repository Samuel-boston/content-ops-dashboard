"use server";

import { revalidatePath, updateTag } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";

/**
 * Owner-only. Only writes fields that were actually provided — a redacted /
 * empty value in the form leaves the stored secret untouched.
 */
export async function updateWorkspaceSettingsAction(formData: FormData) {
  const me = await requireRole("owner");
  const supabase = await supabaseServer();

  const raw = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const keep = (v: string) => v && !v.startsWith("••") && v !== "•••• configured ••••";

  const patch: Record<string, unknown> = { updated_by: me.id, updated_at: new Date().toISOString() };

  // Plain (non-secret) fields — always written (empty clears them).
  patch.cf_account_id = raw("cf_account_id") || null;
  patch.cf_stream_customer_code = raw("cf_stream_customer_code") || null;
  patch.drive_folder_id = raw("drive_folder_id") || null;
  patch.ig_user_id = raw("ig_user_id") || null;
  patch.ig_token_expires_at = raw("ig_token_expires_at") || null;
  patch.telegram_chat_ids = raw("telegram_chat_ids")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  patch.telegram_user_ids = raw("telegram_user_ids")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));

  const provider = raw("ai_provider");
  patch.ai_provider = ["groq", "anthropic", "openai"].includes(provider) ? provider : "groq";

  // Secret fields — only overwrite when a fresh value was entered.
  if (keep(raw("cf_stream_token"))) patch.cf_stream_token = raw("cf_stream_token");
  if (keep(raw("ig_access_token"))) patch.ig_access_token = raw("ig_access_token");
  if (keep(raw("telegram_bot_token"))) patch.telegram_bot_token = raw("telegram_bot_token");
  if (keep(raw("openai_api_key"))) patch.openai_api_key = raw("openai_api_key");
  if (keep(raw("groq_api_key"))) patch.groq_api_key = raw("groq_api_key");
  if (keep(raw("anthropic_api_key"))) patch.anthropic_api_key = raw("anthropic_api_key");
  if (raw("drive_service_account")) {
    try {
      patch.drive_service_account = JSON.parse(raw("drive_service_account"));
    } catch {
      return { error: "Drive service-account JSON is not valid JSON." };
    }
  }

  const { error } = await supabase.from("workspace_settings").update(patch).eq("id", 1);
  if (error) return { error: error.message };
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * The client's name and logo.
 *
 * Kept out of `updateWorkspaceSettingsAction` because that one is built around
 * "don't overwrite a secret with a mask", and branding has no secrets — an
 * empty name here genuinely means "go back to the default".
 */
export async function saveBrandingAction(input: {
  name: string;
  logoPath?: string | null;
}) {
  const me = await requireRole("owner");
  const supabase = await supabaseServer();

  const patch: Record<string, unknown> = {
    brand_name: input.name.trim() || null,
    updated_by: me.id,
    updated_at: new Date().toISOString(),
  };
  // `undefined` means "leave the logo alone"; `null` means "remove it".
  if (input.logoPath !== undefined) patch.brand_logo_path = input.logoPath;

  const { error } = await supabase.from("workspace_settings").update(patch).eq("id", 1);
  if (error) return { error: error.message };

  revalidatePath("/settings");
  // The nav lives in the layout, so the whole tree needs revalidating.
  revalidatePath("/", "layout");
  // …and branding is cached across requests (see lib/workspace.ts), so the
  // path revalidation alone would leave the old name and logo in the nav for
  // up to a minute. `updateTag` rather than `revalidateTag` because this is a
  // server action and the person who just saved should see their own change.
  updateTag("branding");
  return { ok: true };
}
