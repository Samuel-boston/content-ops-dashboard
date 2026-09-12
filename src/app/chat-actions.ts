"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { notify, resolveMentions } from "@/lib/notify";
import type { VideoMessage } from "@/lib/types";

export async function listMessages(videoId: string): Promise<VideoMessage[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("video_messages")
    .select("*, author:profiles!video_messages_author_id_fkey (id, full_name, email)")
    .eq("video_id", videoId)
    .order("created_at");
  return (data as VideoMessage[]) ?? [];
}

export async function sendMessageAction(videoId: string, body: string) {
  const me = await requireUser();
  const text = body.trim();
  if (!text) return { error: "Empty message." };
  const supabase = await supabaseServer();
  const mentions = await resolveMentions(text);
  const { error } = await supabase
    .from("video_messages")
    .insert({ video_id: videoId, author_id: me.id, body: text, mentions });
  if (error) return { error: error.message };

  if (mentions.length) {
    const { data: v } = await supabase.from("videos").select("title").eq("id", videoId).single();
    await notify({
      userIds: mentions.filter((id) => id !== me.id),
      kind: "mention",
      title: `${me.full_name || me.email} mentioned you in “${v?.title ?? "a video"}”`,
      body: text.slice(0, 200),
      link: `/videos/${videoId}`,
      videoId,
    });
  }
  revalidatePath(`/videos/${videoId}`);
  return { ok: true };
}

export async function deleteMessageAction(id: string, videoId: string) {
  await requireUser();
  const supabase = await supabaseServer();
  const { error } = await supabase.from("video_messages").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/videos/${videoId}`);
  return { ok: true };
}
