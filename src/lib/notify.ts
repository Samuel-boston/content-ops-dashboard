import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/integrations/email";
import { sendMessage as sendTelegram, telegramEnabled } from "@/lib/integrations/telegram";
import type { NotificationKind } from "@/lib/types";

interface NotifyInput {
  userIds: string[];
  kind: NotificationKind;
  title: string;
  body?: string;
  link?: string;
  videoId?: string;
  email?: boolean;
}

/**
 * Create in-app notifications for one or more users, and (by default) also send
 * an email. Uses the service-role client so it works from server actions,
 * webhooks and cron alike. Best-effort — never throws into the caller.
 */
export async function notify(input: NotifyInput): Promise<void> {
  const db = supabaseAdmin();
  const uids = [...new Set(input.userIds)].filter(Boolean);
  if (uids.length === 0) return;

  try {
    await db.from("notifications").insert(
      uids.map((user_id) => ({
        user_id,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        video_id: input.videoId ?? null,
      }))
    );
  } catch {
    /* ignore */
  }

  if (input.email !== false) {
    try {
      // Only people who chose "real-time" get an email per notification.
      // "Digest" and "Off" (Notifications page) were being ignored here, so
      // someone who'd switched email off still got one for every message.
      const { data: people } = await db
        .from("profiles")
        .select("email")
        .in("id", uids)
        .eq("active", true)
        .eq("notify_mode", "realtime");
      await Promise.all(
        (people ?? []).map((p: { email: string }) =>
          sendEmail(p.email, input.title, `${input.body ?? ""}\n\n${input.link ?? ""}`.trim())
        )
      );
    } catch {
      /* ignore */
    }
  }
}

/**
 * Extract @mentions ("@Full Name" / "@email") against the known roster.
 *
 * Mention pickers insert a name two different ways: the workspace Composer
 * keeps the space ("@Jane Doe "), the video chat's picker strips it
 * ("@JaneDoe ") so the token stays a single word. Match both, or a mention
 * typed via the video chat silently resolves to zero hits and never notifies.
 */
export async function resolveMentions(body: string): Promise<string[]> {
  if (!body.includes("@")) return [];
  const db = supabaseAdmin();
  const { data: roster } = await db.from("profiles").select("id, full_name, email").eq("active", true);
  const lower = body.toLowerCase();
  const hits = new Set<string>();
  for (const p of roster ?? []) {
    const needles = [p.full_name, p.email, (p.email as string).split("@")[0]].filter(Boolean);
    for (const n of needles) {
      if (!n) continue;
      const needle = String(n).toLowerCase();
      if (lower.includes(`@${needle}`)) {
        hits.add(p.id);
        continue;
      }
      const stripped = needle.replace(/\s+/g, "");
      if (stripped !== needle && lower.includes(`@${stripped}`)) hits.add(p.id);
    }
  }
  return [...hits];
}

/** Notify the Telegram channel too, when it's wired up (used for pool-empty etc). */
export async function notifyTelegram(text: string): Promise<void> {
  try {
    if (await telegramEnabled()) await sendTelegram(text);
  } catch {
    /* ignore */
  }
}
