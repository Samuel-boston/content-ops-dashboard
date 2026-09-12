import "server-only";
import { getWorkspaceSettings } from "@/lib/workspace";

const API = "https://api.telegram.org";

export async function telegramEnabled(): Promise<boolean> {
  const s = await getWorkspaceSettings();
  return Boolean(s.telegram_bot_token && s.telegram_chat_ids.length);
}

/** Is this update from an authorised chat/user? The bot is locked to these. */
export async function isAuthorised(chatId?: number, userId?: number): Promise<boolean> {
  const s = await getWorkspaceSettings();
  const chatOk = chatId != null && s.telegram_chat_ids.includes(chatId);
  const userOk = s.telegram_user_ids.length === 0 || (userId != null && s.telegram_user_ids.includes(userId));
  return chatOk && userOk;
}

export async function sendMessage(text: string, chatId?: number): Promise<void> {
  const s = await getWorkspaceSettings();
  if (!s.telegram_bot_token) return;
  const targets = chatId != null ? [chatId] : s.telegram_chat_ids;
  await Promise.all(
    targets.map((id) =>
      fetch(`${API}/bot${s.telegram_bot_token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: id, text, parse_mode: "HTML" }),
      }).catch(() => {})
    )
  );
}

export async function getFileUrl(fileId: string): Promise<string | null> {
  const s = await getWorkspaceSettings();
  if (!s.telegram_bot_token) return null;
  const res = await fetch(`${API}/bot${s.telegram_bot_token}/getFile?file_id=${fileId}`).then((r) =>
    r.json()
  );
  if (!res?.ok) return null;
  return `${API}/file/bot${s.telegram_bot_token}/${res.result.file_path}`;
}
