import { supabaseAdmin } from "@/lib/supabase/admin";
import { getFileUrl, isAuthorised, sendMessage } from "@/lib/integrations/telegram";
import { transcribeAudio } from "@/lib/integrations/whisper";
import { triageIdea } from "@/lib/intake";
import { CAROUSEL_FORMAT } from "@/lib/taxonomy";

/**
 * The private automations channel — idea capture, mostly.
 *
 * Most content ideas die in the gap between having one and being at a laptop.
 * This closes it: anything sent into the locked Telegram channel lands in
 * Ideation within seconds, where it can be thought about properly later.
 *
 *   1. A voice note   -> Whisper transcript -> new idea, transcript as notes
 *   2. A video file   -> new idea, the clip itself attached as a reference
 *                        (this is what catches a video forwarded or shared
 *                        into the channel from Instagram/TikTok/etc.)
 *   3. A shared link  -> new idea holding the link as a reference
 *   4. Plain text     -> new idea, the message as notes
 *   5. An audio file  -> the Music Library, under "Uncategorized"
 *
 * Everything lands in Ideation rather than Ready to Edit: a thought is not a
 * brief, and dropping half-formed ideas into the editors' pool would make the
 * pool untrustworthy. Pillar / Format / Platform are never auto-filled.
 *
 * Locked to the authorised chat and user ids from Settings → Integrations.
 * Anything else is silently ignored — a bot that argues with strangers is a
 * bot that tells strangers it exists.
 */
export async function POST(req: Request) {
  let update: TgUpdate;
  try {
    update = await req.json();
  } catch {
    return new Response("bad", { status: 400 });
  }
  const msg = update.message;
  if (!msg) return new Response("ok");

  if (!(await isAuthorised(msg.chat?.id, msg.from?.id))) {
    return new Response("ok");
  }

  const db = supabaseAdmin();

  // 1. Voice note -> idea. The raw transcript always becomes the notes (never
  //    lost); if AI is configured, a title + a rough brief guide are drafted
  //    on top of it — not a script, just enough for whoever opens it later to
  //    know what they were thinking without replaying the whole recording.
  if (msg.voice) {
    const url = await getFileUrl(msg.voice.file_id);
    const transcribed = url ? await transcribeAudio(url) : null;
    const transcript = transcribed && "text" in transcribed ? transcribed.text : null;
    const notes = transcript || "(voice note received — transcription unavailable)";
    let title = "Idea from a voice note";
    let brief: string | null = null;
    let carousel = false;

    if (transcript) {
      const t = await triageIdea(transcript);
      title = t.title;
      brief = t.brief;
      carousel = t.carousel;
    }

    const { data: video } = await db
      .from("videos")
      .insert({
        title,
        brief,
        idea_notes: notes,
        needs_script: true,
        status: "ideation",
        priority: "standard",
        ...(carousel ? { formats: [CAROUSEL_FORMAT] } : {}),
      })
      .select("id")
      .single();

    await db.from("automation_events").insert({
      kind: "voice_note_intake",
      video_id: video?.id ?? null,
      detail: { hasTranscript: Boolean(transcript), hasDraftedBrief: Boolean(brief) },
    });
    await sendMessage(
      `💡 Parked in <b>Ideation</b>${carousel ? " as a carousel" : ""}: “${escapeHtml(title)}”${
        transcript ? "" : " — I couldn't transcribe it, so the note is empty."
      }`,
      msg.chat.id
    );
    return new Response("ok");
  }

  // 2. Video -> idea, with the clip itself attached as a reference so it's
  //    right there when whoever picks up the idea opens it. Checked before
  //    the text/link case so a captioned video (which always has *some*
  //    text alongside it) doesn't fall through as a link/text idea instead.
  const video = msg.video || (msg.document && /video\//.test(msg.document.mime_type || "") ? msg.document : null);
  if (video) {
    const url = await getFileUrl(video.file_id);
    const caption = (msg.caption || "").trim();
    const title = caption ? firstLine(caption, 70) : "Idea from a forwarded clip";

    const { data: idea } = await db
      .from("videos")
      .insert({
        title,
        idea_notes: caption || null,
        needs_script: true,
        status: "ideation",
        priority: "standard",
      })
      .select("id")
      .single();

    // Telegram's Bot API caps file downloads around 20MB — a real limit for
    // video, unlike the voice notes and audio this channel otherwise
    // handles. When a clip is too big to fetch, the idea still gets created;
    // it just arrives without the clip attached rather than not at all.
    let attached = false;
    if (url && idea?.id) {
      const res = await fetch(url);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const path = `${crypto.randomUUID()}.mp4`;
        const { error: uploadError } = await db.storage
          .from("references")
          .upload(path, buf, { contentType: video.mime_type || "video/mp4" });
        if (!uploadError) {
          await db.from("reference_items").insert({
            video_id: idea.id,
            kind: "video",
            storage_path: path,
            note: caption || null,
            status: "open",
            last_activity_at: new Date().toISOString(),
          });
          attached = true;
        }
      }
    }

    await db.from("automation_events").insert({
      kind: "video_intake",
      video_id: idea?.id ?? null,
      detail: { attached },
    });
    await sendMessage(
      attached
        ? `🎬 Parked in <b>Ideation</b> with the clip attached: “${escapeHtml(title)}”`
        : `💡 Parked in <b>Ideation</b>: “${escapeHtml(title)}”${
            url ? " — couldn't save the clip (likely too large), so it's just the idea." : " — couldn't fetch the clip, so it's just the idea."
          }`,
      msg.chat.id
    );
    return new Response("ok");
  }

  // 3. Audio file -> music library. Checked before text so a captioned track
  //    doesn't get filed as an idea.
  const audio =
    msg.audio ||
    (msg.document && /audio\//.test(msg.document.mime_type || "") ? msg.document : null);
  if (audio) {
    const url = await getFileUrl(audio.file_id);
    if (url) {
      const res = await fetch(url);
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = (audio.file_name?.split(".").pop() || "mp3").toLowerCase();
      const path = `${crypto.randomUUID()}.${ext}`;
      await db.storage.from("music").upload(path, buf, {
        contentType: audio.mime_type || "audio/mpeg",
      });
      await db.from("music_tracks").insert({
        title: (audio.file_name || "Telegram upload").replace(/\.[^.]+$/, ""),
        category: "Uncategorized",
        storage_path: path,
        duration_seconds: "duration" in audio ? (audio.duration ?? null) : null,
      });
      await db.from("automation_events").insert({ kind: "audio_intake", detail: { path } });
      await sendMessage(
        `🎵 Added to the Music Library (Uncategorized). Tag it when you get a sec.`,
        msg.chat.id
      );
    }
    return new Response("ok");
  }

  // 4. Text — either a shared link or a written thought.
  const text = (msg.text || msg.caption || "").trim();
  if (text) {
    const links = extractLinks(text);
    const isShare = links.length > 0;

    // A shared post is a reference: the link matters more than the words
    // around it, which are usually empty or "look at this".
    const withoutLinks = links.reduce((s, l) => s.replace(l, ""), text).trim();
    // Real words (not just a link) get a proper heading and a format guess;
    // a bare link keeps the "<source> reference" title.
    const wordsToTriage = isShare ? withoutLinks : text;
    const triage = wordsToTriage.length > 0 ? await triageIdea(wordsToTriage) : null;
    const title = triage ? triage.title : `${sourceOf(links[0])} reference`;
    const carousel = triage?.carousel ?? false;

    const notes = isShare
      ? [withoutLinks, "", "Reference:", ...links].filter(Boolean).join("\n")
      : text;

    const { data: video } = await db
      .from("videos")
      .insert({
        title,
        brief: triage?.brief ?? null,
        idea_notes: notes,
        needs_script: true,
        status: "ideation",
        priority: "standard",
        ...(carousel ? { formats: [CAROUSEL_FORMAT] } : {}),
      })
      .select("id")
      .single();

    // Shared links also go into the reference library, so the same post can be
    // found later by someone who isn't looking at this particular idea.
    if (isShare && video?.id) {
      await db.from("reference_items").insert(
        links.map((url) => ({
          video_id: video.id,
          kind: "link",
          url,
          note: withoutLinks || null,
          status: "open",
          last_activity_at: new Date().toISOString(),
        }))
      );
    }

    await db.from("automation_events").insert({
      kind: isShare ? "link_intake" : "text_intake",
      video_id: video?.id ?? null,
      detail: { links },
    });

    await sendMessage(
      isShare
        ? `🔗 Saved as an idea with the link attached${carousel ? " (carousel)" : ""}: “${escapeHtml(title)}”`
        : `💡 Parked in <b>Ideation</b>${carousel ? " as a carousel" : ""}: “${escapeHtml(title)}”`,
      msg.chat.id
    );
    return new Response("ok");
  }

  return new Response("ok");
}

/** Telegram sends the raw text; entities are optional, so parse it ourselves. */
function extractLinks(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"]+/gi) ?? [];
  // Trailing punctuation is almost never part of a pasted URL.
  return [...new Set(matches.map((m) => m.replace(/[).,;!]+$/, "")))];
}

function sourceOf(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("instagram")) return "Instagram";
    if (host.includes("tiktok")) return "TikTok";
    if (host.includes("youtube") || host.includes("youtu.be")) return "YouTube";
    if (host.includes("x.com") || host.includes("twitter")) return "X";
    return host;
  } catch {
    return "Link";
  }
}

function firstLine(s: string, max: number) {
  const line = s.split("\n")[0].trim();
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}

/** The bot posts with parse_mode HTML, so echoed user text has to be escaped. */
function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface TgUpdate {
  message?: {
    chat: { id: number };
    from?: { id: number };
    text?: string;
    caption?: string;
    voice?: { file_id: string; duration?: number };
    video?: { file_id: string; duration?: number; mime_type?: string };
    audio?: { file_id: string; file_name?: string; mime_type?: string; duration?: number };
    document?: { file_id: string; file_name?: string; mime_type?: string };
  };
}
