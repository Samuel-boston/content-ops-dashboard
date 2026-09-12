"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireRole, requireUser } from "@/lib/auth";
import { chatJSON, chatText, aiErrorMessage } from "@/lib/integrations/ai";
import { transcribeAudio } from "@/lib/integrations/whisper";
import { briefVoiceUrl } from "@/app/script-actions";
import { CONTENT_PILLARS } from "@/lib/taxonomy";

// ---------------------------------------------------------------------------
// AI in scripting. Every action here returns a suggestion for the caller to
// show and let someone accept or edit — nothing here writes to a video
// silently. Same credential as Whisper (Settings → Integrations), same
// "return an error string, never throw" shape as the rest of the app's
// integrations.
// ---------------------------------------------------------------------------

const VOICE = `You write for NB Creatives, a video content agency writing short-form scripts for
a client's personal brand on Instagram/TikTok. The voice is direct, a little contrarian, never
corporate, never using em dashes or the word "delve". Hooks stop the scroll in the first
half-second — no throat-clearing, no "in this video".`;

async function videoContext(videoId: string) {
  const supabase = await supabaseServer();
  const { data: v } = await supabase
    .from("videos")
    .select("title, brief, idea_notes, script_hooks, script_body, script_cta, content_pillars, formats, platforms")
    .eq("id", videoId)
    .maybeSingle();
  return v;
}

/**
 * The actual "context and training" this account gets: the SOP/Playbook
 * (Library → SOP) if one's been written, plus real scripts from videos that
 * have already gone out. This is what stops output reading as generic AI —
 * it's grounded in this account's own proven material, refreshed every call
 * rather than a one-time fine-tune that goes stale.
 */
async function brandContext(): Promise<string> {
  const supabase = await supabaseServer();

  const [{ data: sop }, { data: posted }] = await Promise.all([
    supabase.from("sop_docs").select("body").order("position").limit(3),
    supabase
      .from("videos")
      .select("title, script_hooks, script_body, script_cta")
      .eq("status", "posted")
      .order("post_date", { ascending: false })
      .limit(3),
  ]);

  const parts: string[] = [];

  const sopText = (sop ?? [])
    .map((d) => d.body?.trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 1500);
  if (sopText) parts.push(`House style guide — follow this over generic instincts:\n${sopText}`);

  const examples = (posted ?? [])
    .filter((v) => v.script_hooks?.length || v.script_body)
    .map((v) => {
      const lines = [`"${v.title}"`];
      if (v.script_hooks?.[0]) lines.push(`hook: ${v.script_hooks[0]}`);
      if (v.script_body) lines.push(`body: ${v.script_body.slice(0, 280)}`);
      return lines.join("\n");
    })
    .join("\n\n");
  if (examples) {
    parts.push(
      `Real scripts from this account that have already gone out — match THIS tone, not a generic one:\n${examples}`
    );
  }

  return parts.join("\n\n");
}

/**
 * Ten hook OPTIONS — never written into the script directly. The caller
 * shows them as a reviewable list; the person picks which ones (if any)
 * actually become variants. `refinement` carries a follow-up instruction
 * ("make them more like this one", "punchier", "less clickbait") so this
 * doubles as a re-prompt rather than a one-shot generator.
 */
export async function generateHooksAction(videoId: string, refinement?: string) {
  await requireRole("owner", "admin");
  const v = await videoContext(videoId);
  if (!v) return { error: "Video not found." };

  const brand = await brandContext();
  const context = [
    brand,
    `Title: ${v.title}`,
    v.brief ? `Brief: ${v.brief}` : "",
    v.idea_notes ? `Idea notes: ${v.idea_notes}` : "",
    v.content_pillars?.length ? `Content pillar: ${v.content_pillars.join(", ")}` : "",
    v.script_hooks?.length ? `Existing hooks (write different ones, not near-duplicates):\n${v.script_hooks.join("\n")}` : "",
    refinement ? `Steer this batch specifically: ${refinement}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const out = await chatJSON<{ hooks: string[] }>(
    VOICE,
    `${context}\n\nWrite 10 distinct hook OPTIONS (one sentence each, said straight to camera) for THIS video (see Title/Brief above) — not the example videos, those are only for tone. These are options to choose from, not a final answer — make them genuinely different angles, not 10 rewordings of one idea. Respond as JSON: {"hooks": ["...", ...]}`
  );
  if (!out?.hooks?.length) return { error: await aiErrorMessage() };
  return { ok: true as const, hooks: out.hooks.filter(Boolean).slice(0, 10) };
}

/**
 * A full draft — body and CTA — from the brief and (optionally) a chosen
 * hook. `prompt` is specific direction for THIS draft ("make it punchier",
 * "lead with the stat, not the story") — generating blind from just the
 * brief tends to read as generic; a line of direction is what makes it worth
 * using instead of rewriting from scratch.
 */
export async function draftScriptAction(videoId: string, hook?: string, prompt?: string) {
  await requireRole("owner", "admin");
  const v = await videoContext(videoId);
  if (!v) return { error: "Video not found." };

  const hasOwnContent = Boolean(v.brief?.trim() || v.idea_notes?.trim());
  if (!hasOwnContent) {
    return { error: "Add a brief or idea notes first — there's nothing to draft from yet." };
  }

  const brand = await brandContext();
  const context = [
    brand,
    `Title: ${v.title}`,
    v.brief ? `Brief: ${v.brief}` : "",
    v.idea_notes ? `Idea notes: ${v.idea_notes}` : "",
    hook ? `Opening hook (already decided, don't rewrite it): ${hook}` : "",
    v.content_pillars?.length ? `Content pillar: ${v.content_pillars.join(", ")}` : "",
    prompt?.trim() ? `Specific direction for this draft: ${prompt.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const out = await chatJSON<{ body: string; cta: string }>(
    VOICE,
    `${context}\n\nDraft the body (what gets said after the hook — 3-6 short spoken lines, no stage directions) and a one-line call to action, for THIS video (see Title/Brief above). Respond as JSON: {"body": "...", "cta": "..."}`
  );
  if (!out?.body) return { error: await aiErrorMessage() };
  return { ok: true as const, body: out.body.trim(), cta: (out.cta ?? "").trim() };
}

/**
 * Rephrase one selected stretch of the script, in place. Takes the sentence
 * on either side as context so the rewrite still reads as one voice, but only
 * ever returns a replacement for the selection itself — never rewrites
 * anything the person didn't select. Requires the script to already have
 * something in it; there's no "context" to steer a rephrase without a
 * sentence to steer.
 */
export async function rephraseSelectionAction(
  videoId: string,
  selection: string,
  before: string,
  after: string,
  instruction?: string
) {
  await requireRole("owner", "admin");
  if (!selection.trim()) return { error: "Nothing selected." };
  const v = await videoContext(videoId);
  if (!v) return { error: "Video not found." };

  const brand = await brandContext();
  const context = [
    brand,
    `Title: ${v.title}`,
    before ? `…comes after this: "${before.slice(-200)}"` : "",
    after ? `…comes before this: "${after.slice(0, 200)}"` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const ask = instruction?.trim()
    ? `Rewrite this line as directed: "${instruction.trim()}" — keep it flowing with what's before and after it: "${selection}"`
    : `Rewrite ONLY this line, keeping the same meaning and roughly the same length, so it still flows with what's before and after it: "${selection}"`;

  const out = await chatJSON<{ rewrite: string }>(
    VOICE,
    `${context}\n\n${ask}\n\nRespond as JSON: {"rewrite": "..."}`
  );
  if (!out?.rewrite) return { error: await aiErrorMessage() };
  return { ok: true as const, rewrite: out.rewrite.trim() };
}

/** Continue a partial body to a natural finish — needs something to continue from. */
export async function finishScriptAction(videoId: string, partialBody: string) {
  await requireRole("owner", "admin");
  if (!partialBody.trim()) {
    return { error: "Write the start of the body first — there's nothing to finish yet." };
  }
  const v = await videoContext(videoId);
  if (!v) return { error: "Video not found." };

  const brand = await brandContext();
  const context = [
    brand,
    `Title: ${v.title}`,
    v.brief ? `Brief: ${v.brief}` : "",
    v.script_hooks?.[0] ? `Opening hook: ${v.script_hooks[0]}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const out = await chatJSON<{ rest: string }>(
    VOICE,
    `${context}\n\nHere's a script in progress, cut off partway through:\n"${partialBody}"\n\nWrite ONLY what comes next to finish it naturally (don't repeat what's already written) — a couple more short spoken lines, no stage directions, no call to action yet. Respond as JSON: {"rest": "..."}`
  );
  if (!out?.rest) return { error: await aiErrorMessage() };
  return { ok: true as const, rest: out.rest.trim() };
}

/** A CTA suggestion from the finished body — needs a body to react to. */
export async function generateCtaAction(videoId: string) {
  await requireRole("owner", "admin");
  const v = await videoContext(videoId);
  if (!v) return { error: "Video not found." };
  if (!v.script_body?.trim()) {
    return { error: "Write the body first — a CTA needs something to close out." };
  }

  const brand = await brandContext();
  const context = [brand, `Title: ${v.title}`, `Body: ${v.script_body}`].filter(Boolean).join("\n\n");

  const text = await chatText(
    `You write one-line calls to action for short-form video scripts — direct, no hard-selling, matching the tone of the body it closes.`,
    `${context}\n\nWrite one call-to-action line for this video.`
  );
  if (!text) return { error: await aiErrorMessage() };
  return { ok: true as const, cta: text.trim() };
}

/** Turn the recorded spoken brief into a structured hook/body/CTA draft, not one raw paragraph. */
export async function structureBriefAction(videoId: string) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { data: v } = await supabase
    .from("videos")
    .select("brief_voice_path")
    .eq("id", videoId)
    .maybeSingle();
  if (!v?.brief_voice_path) return { error: "No recording to structure." };

  const url = await briefVoiceUrl(v.brief_voice_path);
  if (!url) return { error: "Couldn't read the recording." };

  const transcribed = await transcribeAudio(url);
  if ("error" in transcribed) return { error: transcribed.error };
  const transcript = transcribed.text;

  const out = await chatJSON<{ hooks: string[]; body: string; cta: string }>(
    VOICE,
    `This is a raw, unstructured transcript of someone dictating a video idea out loud:\n\n"${transcript}"\n\n` +
      `Split it into a script: one opening hook (or a couple if they clearly rambled through options), the body, and a call to action. ` +
      `Clean up filler words and false starts, but keep their actual points and phrasing — this is a transcript of a real brief, not a fresh idea. ` +
      `Respond as JSON: {"hooks": ["..."], "body": "...", "cta": "..."}`
  );
  if (!out?.body && !out?.hooks?.length) return { error: await aiErrorMessage() };
  return {
    ok: true as const,
    hooks: (out.hooks ?? []).filter(Boolean),
    body: (out.body ?? "").trim(),
    cta: (out.cta ?? "").trim(),
  };
}

/**
 * Turns the spoken brief into a brief FOR THE EDITOR — a different job than
 * structureBriefAction. That one produces what gets said on camera; this one
 * produces what the editor needs to know to cut it well: what the video's
 * for, tone, pacing, what matters, what to avoid. Fills the "Written brief"
 * field editors actually see, not the script.
 */
export async function buildEditorBriefAction(videoId: string) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { data: v } = await supabase
    .from("videos")
    .select("brief_voice_path, title")
    .eq("id", videoId)
    .maybeSingle();
  if (!v?.brief_voice_path) return { error: "No recording to build a brief from." };

  const url = await briefVoiceUrl(v.brief_voice_path);
  if (!url) return { error: "Couldn't read the recording." };

  const transcribed = await transcribeAudio(url);
  if ("error" in transcribed) return { error: transcribed.error };
  const transcript = transcribed.text;

  const text = await chatText(
    `You write short, clear editing briefs for a video editor — not a script, not a caption. An editor reads ` +
      `this before cutting: what the video needs to accomplish, tone, pacing, what matters, what to avoid. ` +
      `Plain prose, 3-6 sentences, no headers or bullet points.`,
    `Video: "${v.title}"\n\nRaw spoken brief — clean up filler and false starts, keep the actual points:\n"${transcript}"\n\nWrite the editor's brief.`
  );
  if (!text) return { error: await aiErrorMessage() };
  return { ok: true as const, brief: text };
}

/** A caption + hashtags for the Post tab, from the finished script — a different job than the video script itself. */
export async function generateCaptionAction(videoId: string, prompt?: string) {
  await requireRole("owner", "admin");
  const v = await videoContext(videoId);
  if (!v) return { error: "Video not found." };

  const script = [v.script_hooks?.[0], v.script_body, v.script_cta].filter(Boolean).join("\n\n");
  if (!script.trim()) return { error: "This video doesn't have a script yet." };

  const tags = [...(v.content_pillars ?? []), ...(v.formats ?? [])];
  const brand = await brandContext();
  const text = await chatText(
    VOICE,
    `${brand ? `${brand}\n\n` : ""}Video script:\n${script}\n\nWrite an Instagram caption for this post: 2-4 short lines that add to the video rather than repeat it, ` +
      `then a line break, then 5-8 relevant hashtags (mix of broad and specific — no #fyp #viral filler).` +
      (tags.length ? ` Themes to draw hashtags from: ${tags.join(", ")}.` : "") +
      (prompt?.trim() ? ` Specific instruction for this caption: ${prompt.trim()}` : "")
  );
  if (!text) return { error: await aiErrorMessage() };
  return { ok: true as const, caption: text };
}

/**
 * Turns a pile of scattered client review notes into one short punch list
 * for the editor — merging related notes into one item rather than making
 * them read every timestamped comment individually. Only ever reads what's
 * already there; open to any signed-in user (editors included) since it's
 * the editor who most wants this, reading exactly what RLS already lets
 * them see.
 */
export async function summarizeRevisionsAction(videoId: string) {
  await requireUser();
  const supabase = await supabaseServer();

  const { data: v } = await supabase.from("videos").select("title").eq("id", videoId).maybeSingle();
  if (!v) return { error: "Video not found." };

  const { data: cuts } = await supabase.from("video_cuts").select("id").eq("video_id", videoId);
  const cutIds = (cuts ?? []).map((c) => c.id);
  if (!cutIds.length) return { error: "Nothing to summarize yet." };

  const { data: comments } = await supabase
    .from("cut_comments")
    .select("body, author:profiles!cut_comments_author_id_fkey (full_name, email)")
    .in("cut_id", cutIds)
    .eq("resolved", false)
    .order("created_at");

  const open = (comments ?? []) as unknown as {
    body: string;
    author: { full_name: string | null; email: string } | null;
  }[];
  if (!open.length) return { error: "No open notes to summarize." };

  const lines = open.map((c) => `- ${c.author?.full_name || c.author?.email || "Someone"}: ${c.body}`).join("\n");

  const text = await chatText(
    `You summarize a client's scattered video-review notes into one short, actionable punch list for the ` +
      `editor doing the cut. Plain language, no fluff, no restating who said what unless two people disagree.`,
    `Video: "${v.title}"\n\nOpen notes, in the order they were left:\n${lines}\n\n` +
      `Write a short punch list — 3-6 bullet points max — of what actually needs to change. Merge duplicate or ` +
      `related notes into one item rather than listing each verbatim.`
  );
  if (!text) return { error: await aiErrorMessage() };
  return { ok: true as const, summary: text.trim() };
}

export interface IdeaOption {
  title: string;
  hook: string;
  pillar: string;
  why: string;
}

/**
 * A handful of net-new video idea OPTIONS — nothing is saved yet. Two ways
 * to ground them, picked by the caller rather than assumed:
 *   "performers" — take real inspiration from what's actually worked (by
 *                  views), not just "don't repeat the last 12 titles"
 *   "prompt"     — a specific direction ("something about pricing
 *                  objections", "a series like the last one") steers what
 *                  gets proposed instead of a generic free-for-all
 * Either way it still avoids repeating recent titles and stays in the
 * account's own pillars/voice. The caller shows these as cards; the person
 * picks which ones (if any) are worth keeping via `createIdeaFromOptionAction`.
 */
export async function generateIdeaOptionsAction(input: {
  mode: "performers" | "prompt";
  prompt?: string;
}) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();

  const { data: recent } = await supabase
    .from("videos")
    .select("title, content_pillars")
    .order("created_at", { ascending: false })
    .limit(12);

  const recentTitles = (recent ?? []).map((v) => v.title).join("\n");
  const pillarsInUse = [...new Set((recent ?? []).flatMap((v) => v.content_pillars ?? []))];
  const pillars = pillarsInUse.length ? pillarsInUse : [...CONTENT_PILLARS];
  const brand = await brandContext();

  let grounding: string;
  if (input.mode === "prompt") {
    grounding = `Specific direction for these ideas — follow this closely: ${
      input.prompt?.trim() || "(nothing given — use your own judgment)"
    }`;
  } else {
    const { data: posted } = await supabase
      .from("videos")
      .select("id, title, content_pillars")
      .eq("status", "posted")
      .order("post_date", { ascending: false })
      .limit(30);
    const ids = (posted ?? []).map((v) => v.id);
    const { data: metrics } = ids.length
      ? await supabase.from("video_metrics").select("video_id, views").in("video_id", ids)
      : { data: [] as { video_id: string; views: number }[] };
    const viewsById = new Map((metrics ?? []).map((m) => [m.video_id, m.views ?? 0]));
    const top = (posted ?? [])
      .map((v) => ({ ...v, views: viewsById.get(v.id) ?? 0 }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 5)
      .filter((v) => v.views > 0);
    grounding = top.length
      ? `Your best-performing videos so far, by views — take real inspiration from WHY these likely worked ` +
        `(the angle, the pillar, the format), don't just rehash the same topic:\n` +
        top.map((v) => `"${v.title}" — ${v.views.toLocaleString()} views (${v.content_pillars?.join(", ") || "no pillar tagged"})`).join("\n")
      : "Nothing posted with view data yet — lean on the content pillars and house style instead.";
  }

  const out = await chatJSON<{ ideas: IdeaOption[] }>(
    VOICE,
    `${brand ? `${brand}\n\n` : ""}This account's content pillars: ${pillars.join(", ")}.\n\n` +
      `${grounding}\n\n` +
      `Recently made videos (don't repeat these):\n${recentTitles || "(none yet)"}\n\n` +
      `Propose 4 distinct new video ideas — different pillars/angles from each other, not variations of one. ` +
      `For each: a short working title, an opening hook, which pillar it belongs to (must be one of the pillars listed), ` +
      `and one line on why it'd work for this account specifically. ` +
      `Respond as JSON: {"ideas": [{"title": "...", "hook": "...", "pillar": "...", "why": "..."}, ...]}`
  );
  if (!out?.ideas?.length) return { error: await aiErrorMessage() };

  const ideas = out.ideas
    .filter((i) => i?.title)
    .map((i) => ({ ...i, pillar: pillars.includes(i.pillar) ? i.pillar : pillars[0] }));
  return { ok: true as const, ideas };
}

/** Saves exactly the one idea option the person picked — same shape as the New Video form's own insert. */
export async function createIdeaFromOptionAction(option: IdeaOption) {
  const me = await requireRole("owner", "admin");
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("videos")
    .insert({
      title: option.title.trim(),
      status: "ideation",
      content_pillars: option.pillar ? [option.pillar] : [],
      script_hooks: option.hook?.trim() ? [option.hook.trim()] : [],
      idea_notes: option.why?.trim() || null,
      needs_script: true,
      created_by: me.id,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/ideation");
  revalidatePath("/");
  return { ok: true as const, id: data.id as string };
}

/**
 * The in-app "record an idea" flow on Ideation — a deliberate sit-down
 * capture, so it's worth going further than the Telegram quick-intake does:
 * title, a proper brief, a rough opening hook, the pillar it fits, and a
 * music mood suggestion, all from one spoken description. Takes a storage
 * path (the comment-media bucket, same as the scripting brief recorder) so
 * the caller never has to handle a transcript directly.
 */
export async function draftIdeaFromRecordingAction(storagePath: string) {
  await requireRole("owner", "admin");
  const url = await briefVoiceUrl(storagePath);
  if (!url) return { error: "Couldn't read the recording." };

  const transcribed = await transcribeAudio(url);
  if ("error" in transcribed) return { error: transcribed.error };
  const transcript = transcribed.text;

  const brand = await brandContext();
  const out = await chatJSON<{
    title: string;
    brief: string;
    hook: string;
    pillar: string;
    musicMood: string;
  }>(
    VOICE,
    `${brand ? `${brand}\n\n` : ""}Content pillars available: ${CONTENT_PILLARS.join(", ")}.\n\n` +
      `Someone just described a video idea out loud. Raw transcript — clean up filler and false starts, keep their actual points:\n"${transcript}"\n\n` +
      `Turn it into: a short working title, a 2-3 sentence brief (what the video is and what it needs to do), ` +
      `one opening hook option, which content pillar it fits best (must be one of the pillars listed), ` +
      `and a one/two-word music mood for it (e.g. "upbeat", "cinematic / moody"). ` +
      `Respond as JSON: {"title": "...", "brief": "...", "hook": "...", "pillar": "...", "musicMood": "..."}`
  );
  if (!out?.title) return { error: await aiErrorMessage() };
  return {
    ok: true as const,
    title: out.title.trim(),
    brief: (out.brief ?? "").trim(),
    hook: (out.hook ?? "").trim(),
    pillar: CONTENT_PILLARS.includes(out.pillar as (typeof CONTENT_PILLARS)[number])
      ? out.pillar
      : CONTENT_PILLARS[0],
    musicMood: (out.musicMood ?? "").trim(),
  };
}

/**
 * Saves the reviewed voice-drafted idea, carrying the original recording
 * over onto the video as its spoken brief — so opening it in Scripting
 * later, the same recording (and "Structure into script" / "Build editor
 * brief") is right there, not lost after the idea was created.
 */
export async function createIdeaFromVoiceDraftAction(input: {
  title: string;
  brief: string;
  hook: string;
  pillar: string;
  musicMood: string;
  voice: { path: string; duration: number; peaks: number[] };
}) {
  const me = await requireRole("owner", "admin");
  const supabase = await supabaseServer();

  const brief = [input.brief, input.musicMood ? `Music mood: ${input.musicMood}.` : ""]
    .filter(Boolean)
    .join(" ");

  const { data, error } = await supabase
    .from("videos")
    .insert({
      title: input.title.trim(),
      status: "ideation",
      content_pillars: input.pillar ? [input.pillar] : [],
      script_hooks: input.hook?.trim() ? [input.hook.trim()] : [],
      brief: brief || null,
      brief_voice_path: input.voice.path,
      brief_voice_duration_seconds: input.voice.duration,
      brief_voice_peaks: input.voice.peaks,
      needs_script: true,
      created_by: me.id,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/ideation");
  revalidatePath("/");
  return { ok: true as const, id: data.id as string };
}
