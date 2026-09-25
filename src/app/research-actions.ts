"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { assertPublicHttpsUrl } from "@/lib/safe-url";
import { currentResearchPrompt, sendResearchWebhook, buildResearchBlock } from "@/lib/research";

export interface ResearchSetup {
  prompt: string;
  custom: boolean;
  autoAdd: boolean;
  webhookUrl: string;
  docTitles: string[];
  chatgptUrl: string;
  claudeUrl: string;
  appUrl: string;
  hasOfferDoc: boolean;
  hasClientDoc: boolean;
  /** Only the owner can see or change the webhook (it works like a password). */
  isOwner: boolean;
}

export async function getResearchSetupAction(): Promise<ResearchSetup> {
  const me = await requireRole("owner", "admin");
  const isOwner = me.role === "owner";
  const db = supabaseAdmin();
  const [cur, { data: s }] = await Promise.all([
    currentResearchPrompt(db),
    db.from("workspace_settings").select("research_webhook_url").eq("id", 1).maybeSingle(),
  ]);
  const lower = cur.docTitles.map((t) => t.toLowerCase());
  return {
    prompt: cur.prompt,
    custom: cur.custom,
    autoAdd: cur.autoAdd,
    webhookUrl: isOwner ? ((s?.research_webhook_url as string | null) ?? "") : "",
    isOwner,
    docTitles: cur.docTitles,
    chatgptUrl: cur.chatgpt,
    claudeUrl: cur.claude,
    appUrl: (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, ""),
    hasOfferDoc: lower.some((t) => /offer/.test(t)),
    hasClientDoc: lower.some((t) => /(ideal|client|avatar|audience)/.test(t)),
  };
}

export async function saveResearchSettingsAction(input: { prompt: string | null; autoAdd: boolean; webhookUrl: string }) {
  const me = await requireRole("owner");
  const url = input.webhookUrl.trim();
  if (url) {
    try {
      await assertPublicHttpsUrl(url);
    } catch (e) {
      return { error: (e as Error).message };
    }
  }
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("workspace_settings")
    .update({
      research_prompt: input.prompt?.trim() || null,
      research_auto_add: input.autoAdd,
      research_webhook_url: url || null,
      updated_by: me.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) return { error: error.message };
  revalidatePath("/library/top-posts");
  return { ok: true as const };
}

/** Two empty docs in the playbook — the offer and the ideal client — for the client to fill in. */
export async function createStarterDocsAction() {
  const me = await requireRole("owner", "admin");
  const db = supabaseAdmin();
  const { data: have } = await db.from("sop_docs").select("title");
  const titles = new Set((have ?? []).map((d) => String(d.title).toLowerCase()));
  const starters = [
    {
      title: "Our offer",
      body: "What we sell, in plain words.\n\n- The offer:\n- Who it is for:\n- The result it gives:\n- Price point:\n- What makes it different:\n",
    },
    {
      title: "Ideal client",
      body: "Who we want to reach.\n\n- Who they are (role, age, situation):\n- What they struggle with:\n- What they have already tried:\n- What they want instead:\n- Words they use to describe it:\n- Accounts and creators they already follow:\n",
    },
  ].filter((d) => !titles.has(d.title.toLowerCase()));
  if (!starters.length) return { ok: true as const, created: 0 };
  const { error } = await db.from("sop_docs").insert(starters.map((d, i) => ({ ...d, position: i, updated_by: me.id })));
  if (error) return { error: error.message };
  revalidatePath("/library/sop");
  revalidatePath("/library/top-posts");
  return { ok: true as const, created: starters.length };
}

export async function testResearchWebhookAction(): Promise<{ ok: boolean; message: string }> {
  await requireRole("owner");
  const block = await buildResearchBlock(supabaseAdmin());
  const res = await sendResearchWebhook(block);
  if (!res) return { ok: false, message: "No webhook address is saved yet." };
  return res.ok
    ? { ok: true, message: `Sent. The other end answered ${res.status}.` }
    : { ok: false, message: res.error ?? `The other end answered ${res.status}.` };
}
