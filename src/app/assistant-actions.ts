"use server";

import { supabaseServer } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { chatJSON, chatText, aiErrorMessage } from "@/lib/integrations/ai";
import { generateCaptionAction } from "@/app/ai-actions";
import { CONTENT_PILLARS, FORMATS, PLATFORMS } from "@/lib/taxonomy";
import { PUBLISH_CHANNELS, STATUS_LABELS, type PublishChannel, type VideoStatus } from "@/lib/types";

/**
 * The in-app assistant. Deliberately NOT a tool-calling agent loop — a
 * single structured-output call classifies the question into one of a fixed
 * set of intents, then a plain, deterministic Supabase query answers it. The
 * model never sees the video table and never writes to it; it only ever
 * extracts parameters from a sentence. That's what keeps this safe to point
 * at a real production database: there is no path from "the model said so"
 * to a row changing — every intent that mutates something (`move_stage`,
 * `tag_teammate`, `reassign_editor`, `set_eta`, `schedule_post`,
 * `create_idea`) returns a proposal the UI must be told to confirm, which
 * then runs through the exact same server action every equivalent button
 * elsewhere in the app already uses. `find_video`/`list_videos`/
 * `top_performers`/`draft_caption`/`report_now` only ever read.
 */

interface Intent {
  intent:
    | "find_video"
    | "list_videos"
    | "top_performers"
    | "move_stage"
    | "tag_teammate"
    | "reassign_editor"
    | "set_eta"
    | "draft_caption"
    | "schedule_post"
    | "create_idea"
    | "report_now"
    | "how_to"
    | "unknown";
  searchText: string | null;
  daysBack: number | null;
  status: string | null;
  format: string | null;
  platform: string | null;
  pillar: string | null;
  toStatus: string | null;
  limit: number | null;
  /** tag_teammate / reassign_editor: who, by name. */
  personName: string | null;
  /** tag_teammate: the message to leave them. draft_caption/schedule_post: a style note. */
  note: string | null;
  /** set_eta: an absolute date, YYYY-MM-DD, resolved from whatever phrase was given. */
  etaISO: string | null;
  /** create_idea: a short working title for the new idea. */
  ideaTitle: string | null;
  /** schedule_post: channels to post to, from the known list below. */
  channels: string[] | null;
  /** schedule_post: an absolute date/time, ISO 8601, resolved from whatever phrase was given (e.g. "today" -> today at a sensible posting hour). */
  scheduledISO: string | null;
}

export interface AssistantVideoRow {
  id: string;
  title: string;
  status: VideoStatus;
  postDate: string | null;
  postedAt: string | null;
  editor: string | null;
  views: number | null;
}

export type AssistantAction =
  | { type: "move_stage"; videoId: string; videoTitle: string; toStatus: VideoStatus; label: string }
  | {
      type: "tag_teammate";
      videoId: string;
      videoTitle: string;
      personName: string;
      body: string;
      label: string;
    }
  | {
      type: "reassign_editor";
      videoId: string;
      videoTitle: string;
      editorId: string;
      editorName: string;
      label: string;
    }
  | { type: "set_eta"; videoId: string; videoTitle: string; etaISO: string; label: string }
  | { type: "create_idea"; title: string; notes: string | null; label: string }
  | {
      type: "schedule_post";
      videoId: string;
      videoTitle: string;
      cutId: string | null;
      caption: string;
      channels: PublishChannel[];
      scheduledISO: string | null;
      label: string;
    };

export interface AssistantReply {
  ok: boolean;
  text: string;
  rows?: AssistantVideoRow[];
  action?: AssistantAction;
}

const STATUS_VALUES = Object.keys(STATUS_LABELS) as VideoStatus[];

/**
 * What Andreas is told about the dashboard itself, for "how do I..." questions.
 * Kept as one flat block, not pulled from the schema/routes — deliberately a
 * human-written summary of what a user actually sees, so it reads like a
 * teammate explaining the tool rather than a database dump. Update this when
 * a page's purpose materially changes, not on every UI tweak.
 */
const HOW_TO_KNOWLEDGE = `
Pipeline, in order a video moves through it: Ideation -> Scripting -> Ready to Film -> Editor Brief -> Ready to Edit -> Editing (assigning an editor is what moves it here) -> In Review -> Revisions (if changes are asked for, back to editing) -> Approved (never sits here, routes on instantly) -> Awaiting Variants (only if the script had more than one hook) -> Final Review -> Ready to Post -> Posted.

Ideation and Scripting are private to the owner/admin — editors never see them. Everything from Ready to Edit onward is what editors work in.

Pages:
- Overview (home): Andreas's opener with the pipeline stages that most need attention, "what's new" since you were last here, performance and runway panels, the pipeline strip, and the team snapshot.
- Ideation: the private idea shelf. Add ideas manually, capture one by voice, or use "Suggest ideas" (AI, grounded either in your best-performing past videos or a prompt you give it) to generate options you can add straight in. Each idea has a brief, references (paste any link), and pillar/format/platform tags. "Script it" moves it to Scripting.
- Scripting: where the brief becomes a script — hooks, body, CTA. "Draft with AI" opens a prompt box first. Select text to Rephrase it. "Suggest 10 hooks" generates hook options. More than one hook in the script means it'll route through Awaiting Variants later. "Send to editors" moves it to Ready to Film.
- Ready to Film / Editor Brief: gives the script, a teleprompter view, priority, and a place to tag music from the library and add screen-recording references for the editor.
- Ready to Edit (the board editors see): brief, raw footage link, music, priority — nothing else, on purpose.
- Review: the client's approval queue — cuts, hook variants, comments (pinned to a timestamp, with voice notes and drawings), Approve or send back to Revisions.
- Revisions: sent back with open notes; "Summarize" turns scattered comments into a short punch list for the editor.
- Awaiting Variants / Final Review / Ready to Post / Posted: last steps before and after a video goes out; Ready to Post is where scheduling/publishing happens.
- Board: the full pipeline in one kanban view.
- Calendar: everything by post date.
- Team: who's assigned what, workload, editor rates/payments.
- Analytics / Report: performance by video, pillar, format, platform.
- Library: shared music tracks, brand/screen-recording references, and SOP docs.
- Series, Archive, Parked ("Later"), Publishing: series groupings, posted history, ideas/videos shelved for later, and the publishing queue.
- Ask Andreas (this chat): finds videos, lists them by filter, pulls top performers, and — with a confirm click — moves a stage, tags a teammate, reassigns an editor, sets an ETA, drafts a caption, schedules a post, or logs a new idea.
- Connect your AI assistant: its OWN separate link in the account menu (top-right avatar), open to any signed-in user — NOT inside Settings, not owner-only. Generate a token there to let an external AI (Claude, ChatGPT, etc. — whichever you already use) read and write the dashboard directly from its own chat, with the same permissions you have here.
- Settings: a DIFFERENT page, owner-only, also reached from the account menu — integration credentials (Cloudflare Stream, Google Drive, Instagram, Telegram) and which AI engine (Groq/Claude/OpenAI) powers the in-app AI features. Has nothing to do with connecting an external AI assistant — don't conflate the two.
`.trim();

async function classify(question: string, people: string[]): Promise<Intent | null> {
  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);
  const todayWeekday = today.toLocaleDateString("en-US", { weekday: "long" });
  const out = await chatJSON<Intent>(
    `You turn one sentence into a structured lookup or proposal against a video-production tracker. You never ` +
      `answer the question yourself and you never act — you only extract what's needed for a database query or a ` +
      `proposal a human will have to confirm. Today is ${todayWeekday}, ${todayISO}. Use it to resolve relative ` +
      `dates into an absolute YYYY-MM-DD (or a full ISO datetime when a time matters): a bare weekday name ` +
      `("Friday") always means the NEAREST such day from today, i.e. tomorrow if today is Thursday and this ` +
      `week's Friday hasn't happened yet — never skip ahead to next week unless "next" is actually said.`,
    `Statuses in the pipeline, in order: ${STATUS_VALUES.join(", ")}.\n` +
      `Known formats: ${FORMATS.join(", ")}. Known platforms: ${PLATFORMS.join(", ")}. Known content pillars: ${CONTENT_PILLARS.join(", ")}.\n` +
      `People on the team: ${people.join(", ") || "(none)"}.\n` +
      `Publishing channels: ${PUBLISH_CHANNELS.join(", ")}.\n\n` +
      `Classify this request: "${question}"\n\n` +
      `Pick ONE intent:\n` +
      `- "find_video": asking where a specific video is, or to find one by topic/title (e.g. "where's the pricing video", "find that video about editors from 2 months ago"). searchText is ONLY the distinctive topic/title words — drop generic words like "video", "post", "clip", "that", "the". Add a rough time hint in daysBack if one was given (e.g. "2 months ago" -> 60).\n` +
      `- "list_videos": asking for a filtered list (by format/platform/pillar/status/time window), not analytics-ranked.\n` +
      `- "top_performers": asking which videos performed best/worst, by views or engagement, over some window. daysBack from any "last N months/weeks" phrase (default 180 if posting performance is implied but no window given).\n` +
      `- "move_stage": asking to move/change a specific video's stage (e.g. "move the pricing video to ready to edit"). searchText is the video, toStatus must be one of the exact status values listed above.\n` +
      `- "tag_teammate": asking to tag/mention/tell/loop in a specific person on a specific video (e.g. "tell Nathan to check the pricing video", "tag Nathan on the testimonial video and ask him to review it"). searchText is the video, personName is their name (must match someone in the people list), note is the message to leave them — write it as a short first-person note from the person asking, addressed to that teammate.\n` +
      `- "reassign_editor": asking to give/assign/hand a video to a specific editor. searchText is the video, personName is the editor.\n` +
      `- "set_eta": asking to set/change when a video is due. searchText is the video, etaISO is the resolved absolute date.\n` +
      `- "draft_caption": asking to write/draft a caption (or hashtags) for a specific video, without asking to schedule it. searchText is the video, note is any style instruction given.\n` +
      `- "schedule_post": asking to schedule/post/publish a specific video (e.g. "schedule the pricing video for today", "post the testimonial to instagram and tiktok tomorrow"). searchText is the video, channels is whichever known channels were named (null if none named), scheduledISO is the resolved date/time (null if "now"/unspecified), note is any caption style instruction.\n` +
      `- "create_idea": asking to add/log/capture a new idea (not about an existing video). ideaTitle is a short working title, note is any extra detail given.\n` +
      `- "report_now": asking for a status report / summary of where things stand right now (e.g. "give me this week's rundown", "what's the state of things").\n` +
      `- "how_to": asking how to USE the dashboard itself — a feature, a page, a workflow, "where do I find X", "what does X do" — not asking about a specific video's data.\n` +
      `- "unknown": anything else (general chat, out of scope).\n\n` +
      `format/platform/pillar must be exact matches from the known lists above, or null if not mentioned or not a match. status must be one of the exact status values above, or null. limit defaults to 10 if a count wasn't specified. channels must only contain exact values from the known channels list.\n` +
      `Respond as JSON: {"intent": "...", "searchText": "..." | null, "daysBack": 0 | null, "status": "..." | null, "format": "..." | null, "platform": "..." | null, "pillar": "..." | null, "toStatus": "..." | null, "limit": 0 | null, "personName": "..." | null, "note": "..." | null, "etaISO": "..." | null, "ideaTitle": "..." | null, "channels": ["..."] | null, "scheduledISO": "..." | null}`
  );
  return out;
}

interface Person {
  id: string;
  full_name: string | null;
  email: string;
}

/** Same forgiving match resolveMentions() uses for @-mentions — first name, full name, or email local-part, case-insensitive. */
function matchPerson(name: string | null, roster: Person[]): Person | null {
  if (!name?.trim()) return null;
  const needle = name.trim().toLowerCase();
  return (
    roster.find((p) => (p.full_name || "").toLowerCase() === needle) ??
    roster.find((p) => (p.full_name || "").toLowerCase().includes(needle)) ??
    roster.find((p) => p.email.split("@")[0].toLowerCase() === needle) ??
    null
  );
}

function since(daysBack: number | null): string | null {
  if (!daysBack || daysBack <= 0) return null;
  return new Date(Date.now() - daysBack * 864e5).toISOString();
}

const STOPWORDS = new Set([
  "the", "a", "an", "that", "this", "video", "clip", "post", "reel", "one", "about", "on", "of",
]);

/**
 * The model sometimes includes a generic word ("video", "that") alongside the
 * real title fragment — matching the whole phrase as one substring then fails
 * even though the actual title words are right there. Matching on ANY
 * significant word instead is far more forgiving, at the cost of occasionally
 * over-matching — an acceptable trade for a search box, not a delete button.
 */
function titleWords(searchText: string): string[] {
  return searchText
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function titleOrFilter(searchText: string): string {
  const words = titleWords(searchText);
  const terms = words.length ? words : [searchText.trim()];
  return terms.map((w) => `title.ilike.%${w}%`).join(",");
}

const BASE_SELECT =
  "id, title, status, post_date, posted_at, assigned_editor:profiles!videos_assigned_editor_id_fkey (full_name, email)";

interface VideoRow {
  id: string;
  title: string;
  status: VideoStatus;
  post_date: string | null;
  posted_at: string | null;
  assigned_editor: { full_name: string | null; email: string } | null;
}

// Supabase's generated types infer a `!fkey` reference join as an array even
// though it's a to-one relation and returns a single object at runtime —
// same blunt cast used everywhere else in this codebase for this join.
function toRows(data: unknown, viewsById?: Map<string, number>): AssistantVideoRow[] {
  return (data as VideoRow[]).map((v) => ({
    id: v.id,
    title: v.title,
    status: v.status,
    postDate: v.post_date,
    postedAt: v.posted_at,
    editor: v.assigned_editor?.full_name || v.assigned_editor?.email || null,
    views: viewsById?.get(v.id) ?? null,
  }));
}

type VideoLookupRow = { id: string; title: string; status: VideoStatus };

/** The same "no match / ambiguous / exactly one" resolution move_stage uses, shared by every other intent that targets one existing video. */
async function resolveOneVideo(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  searchText: string
): Promise<{ video: VideoLookupRow } | { reply: AssistantReply }> {
  const { data, error } = await supabase
    .from("videos")
    .select("id, title, status")
    .or(titleOrFilter(searchText))
    .limit(5);
  if (error) return { reply: { ok: false, text: error.message } };
  if (!data?.length) return { reply: { ok: true, text: `Nothing matching "${searchText}".` } };
  if (data.length > 1) {
    return {
      reply: {
        ok: true,
        text: `More than one matches "${searchText}" — which one?`,
        rows: toRows(data.map((v) => ({ ...v, post_date: null, posted_at: null, assigned_editor: null }))),
      },
    };
  }
  return { video: data[0] as VideoLookupRow };
}

export async function assistantQueryAction(question: string): Promise<AssistantReply> {
  await requireRole("owner", "admin");
  if (!question.trim()) return { ok: false, text: "Ask me something first." };

  const supabase = await supabaseServer();
  const { data: roster } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("active", true);
  const people = (roster as Person[]) ?? [];

  const parsed = await classify(question, people.map((p) => p.full_name || p.email.split("@")[0]));
  if (!parsed) {
    return {
      ok: false,
      text: await aiErrorMessage(),
    };
  }

  const limit = Math.min(Math.max(parsed.limit ?? 10, 1), 25);

  if (parsed.intent === "find_video") {
    if (!parsed.searchText?.trim()) {
      return { ok: false, text: "Which video? Give me a word or two from the title." };
    }
    let q = supabase.from("videos").select(BASE_SELECT).or(titleOrFilter(parsed.searchText));
    const sinceIso = since(parsed.daysBack);
    if (sinceIso) q = q.or(`created_at.gte.${sinceIso},post_date.gte.${sinceIso.slice(0, 10)}`);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
    if (error) return { ok: false, text: error.message };
    const rows = toRows(data ?? []);
    if (!rows.length) {
      return { ok: true, text: `Nothing matching "${parsed.searchText}".` };
    }
    if (rows.length === 1) {
      const r = rows[0];
      return {
        ok: true,
        text: `"${r.title}" is in ${STATUS_LABELS[r.status]}${r.editor ? `, with ${r.editor}` : ""}.`,
        rows,
      };
    }
    return { ok: true, text: `${rows.length} videos match "${parsed.searchText}":`, rows };
  }

  if (parsed.intent === "list_videos") {
    let q = supabase.from("videos").select(BASE_SELECT);
    if (parsed.status && STATUS_VALUES.includes(parsed.status as VideoStatus)) {
      q = q.eq("status", parsed.status);
    }
    if (parsed.format) q = q.contains("formats", [parsed.format]);
    if (parsed.platform) q = q.contains("platforms", [parsed.platform]);
    if (parsed.pillar) q = q.contains("content_pillars", [parsed.pillar]);
    const sinceIso = since(parsed.daysBack);
    if (sinceIso) q = q.gte(parsed.status === "posted" ? "posted_at" : "created_at", sinceIso);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
    if (error) return { ok: false, text: error.message };
    const rows = toRows(data ?? []);
    const bits = [parsed.status ? STATUS_LABELS[parsed.status as VideoStatus] : null, parsed.format, parsed.platform, parsed.pillar]
      .filter(Boolean)
      .join(", ");
    if (!rows.length) return { ok: true, text: `Nothing matches${bits ? ` (${bits})` : ""}.` };
    return { ok: true, text: `${rows.length} video${rows.length === 1 ? "" : "s"}${bits ? ` — ${bits}` : ""}:`, rows };
  }

  if (parsed.intent === "top_performers") {
    const sinceIso = since(parsed.daysBack ?? 180) ?? since(180)!;
    const { data: videos, error } = await supabase
      .from("videos")
      .select(BASE_SELECT)
      .eq("status", "posted")
      .gte("posted_at", sinceIso)
      .order("posted_at", { ascending: false });
    if (error) return { ok: false, text: error.message };
    const ids = (videos ?? []).map((v) => v.id);
    const { data: metrics } = ids.length
      ? await supabase.from("video_metrics").select("video_id, views").in("video_id", ids)
      : { data: [] as { video_id: string; views: number }[] };
    const viewsById = new Map((metrics ?? []).map((m) => [m.video_id, m.views ?? 0]));
    const rows = toRows(videos ?? [], viewsById)
      .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
      .slice(0, limit);
    if (!rows.length) return { ok: true, text: "Nothing posted in that window yet." };
    return { ok: true, text: `Top ${rows.length} by views, posted in the last ${parsed.daysBack ?? 180} days:`, rows };
  }

  if (parsed.intent === "move_stage") {
    if (!parsed.searchText?.trim()) return { ok: false, text: "Which video should I move?" };
    if (!parsed.toStatus || !STATUS_VALUES.includes(parsed.toStatus as VideoStatus)) {
      return { ok: false, text: "I couldn't tell which stage to move it to." };
    }
    const { data, error } = await supabase
      .from("videos")
      .select("id, title, status")
      .or(titleOrFilter(parsed.searchText))
      .limit(5);
    if (error) return { ok: false, text: error.message };
    if (!data?.length) return { ok: true, text: `Nothing matching "${parsed.searchText}".` };
    if (data.length > 1) {
      return {
        ok: true,
        text: `More than one matches "${parsed.searchText}" — which one?`,
        rows: toRows(
          data.map((v) => ({ ...v, post_date: null, posted_at: null, assigned_editor: null }))
        ),
      };
    }
    const v = data[0];
    const toStatus = parsed.toStatus as VideoStatus;
    if (v.status === toStatus) {
      return { ok: true, text: `"${v.title}" is already in ${STATUS_LABELS[toStatus]}.` };
    }
    return {
      ok: true,
      text: `Move "${v.title}" from ${STATUS_LABELS[v.status as VideoStatus]} to ${STATUS_LABELS[toStatus]}?`,
      action: {
        type: "move_stage",
        videoId: v.id,
        videoTitle: v.title,
        toStatus,
        label: `Move to ${STATUS_LABELS[toStatus]}`,
      },
    };
  }

  if (parsed.intent === "tag_teammate") {
    if (!parsed.searchText?.trim()) return { ok: false, text: "Which video?" };
    const person = matchPerson(parsed.personName, people);
    if (!person) return { ok: false, text: `I couldn't tell who "${parsed.personName ?? "that"}" is on the team.` };
    const found = await resolveOneVideo(supabase, parsed.searchText);
    if ("reply" in found) return found.reply;
    const name = person.full_name || person.email;
    const note = parsed.note?.trim() || `Can you take a look at this?`;
    const body = `@${name} ${note}`;
    return {
      ok: true,
      text: `Tag ${name} on "${found.video.title}" — "${note}"?`,
      action: {
        type: "tag_teammate",
        videoId: found.video.id,
        videoTitle: found.video.title,
        personName: name,
        body,
        label: `Tag ${name}`,
      },
    };
  }

  if (parsed.intent === "reassign_editor") {
    if (!parsed.searchText?.trim()) return { ok: false, text: "Which video?" };
    const editor = matchPerson(parsed.personName, people);
    if (!editor) return { ok: false, text: `I couldn't tell who "${parsed.personName ?? "that"}" is on the team.` };
    const found = await resolveOneVideo(supabase, parsed.searchText);
    if ("reply" in found) return found.reply;
    const name = editor.full_name || editor.email;
    return {
      ok: true,
      text: `Give "${found.video.title}" to ${name}?`,
      action: {
        type: "reassign_editor",
        videoId: found.video.id,
        videoTitle: found.video.title,
        editorId: editor.id,
        editorName: name,
        label: `Assign to ${name}`,
      },
    };
  }

  if (parsed.intent === "set_eta") {
    if (!parsed.searchText?.trim()) return { ok: false, text: "Which video?" };
    if (!parsed.etaISO) return { ok: false, text: "I couldn't tell what date you meant." };
    const found = await resolveOneVideo(supabase, parsed.searchText);
    if ("reply" in found) return found.reply;
    const etaDate = new Date(parsed.etaISO);
    const when = Number.isNaN(etaDate.getTime())
      ? parsed.etaISO
      : etaDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return {
      ok: true,
      text: `Set "${found.video.title}"'s ETA to ${when}?`,
      action: {
        type: "set_eta",
        videoId: found.video.id,
        videoTitle: found.video.title,
        etaISO: parsed.etaISO,
        label: `Set ETA to ${when}`,
      },
    };
  }

  if (parsed.intent === "draft_caption") {
    if (!parsed.searchText?.trim()) return { ok: false, text: "Which video?" };
    const found = await resolveOneVideo(supabase, parsed.searchText);
    if ("reply" in found) return found.reply;
    const drafted = await generateCaptionAction(found.video.id, parsed.note ?? undefined);
    if (!drafted?.ok) return { ok: false, text: drafted?.error ?? "Couldn't draft a caption." };
    return { ok: true, text: `Caption for "${found.video.title}":\n\n${drafted.caption}` };
  }

  if (parsed.intent === "schedule_post") {
    if (!parsed.searchText?.trim()) return { ok: false, text: "Which video?" };
    const found = await resolveOneVideo(supabase, parsed.searchText);
    if ("reply" in found) return found.reply;

    const { data: cut } = await supabase
      .from("video_cuts")
      .select("id")
      .eq("video_id", found.video.id)
      .eq("kind", "main")
      .maybeSingle();

    const drafted = await generateCaptionAction(found.video.id, parsed.note ?? undefined);
    if (!drafted?.ok) {
      return {
        ok: false,
        text: `I can propose the schedule, but drafting a caption failed: ${drafted?.error ?? "unknown error"}`,
      };
    }

    const channels = (parsed.channels?.filter((c) =>
      PUBLISH_CHANNELS.includes(c as PublishChannel)
    ) ?? []) as PublishChannel[];
    const useChannels = channels.length ? channels : (["instagram"] as PublishChannel[]);

    const whenLabel = parsed.scheduledISO
      ? new Date(parsed.scheduledISO).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "right away";

    return {
      ok: true,
      text: `Schedule "${found.video.title}" for ${whenLabel} on ${useChannels.join(", ")} with this caption?\n\n${drafted.caption}`,
      action: {
        type: "schedule_post",
        videoId: found.video.id,
        videoTitle: found.video.title,
        cutId: cut?.id ?? null,
        caption: drafted.caption,
        channels: useChannels,
        scheduledISO: parsed.scheduledISO,
        label: "Schedule it",
      },
    };
  }

  if (parsed.intent === "create_idea") {
    if (!parsed.ideaTitle?.trim()) return { ok: false, text: "What's the idea?" };
    return {
      ok: true,
      text: `Add "${parsed.ideaTitle}" as a new idea?`,
      action: {
        type: "create_idea",
        title: parsed.ideaTitle.trim(),
        notes: parsed.note?.trim() || null,
        label: "Add idea",
      },
    };
  }

  if (parsed.intent === "report_now") {
    const [{ count: active }, { data: stuck }, { data: dueSoon }] = await Promise.all([
      supabase
        .from("videos")
        .select("id", { count: "exact", head: true })
        .is("parked_at", null)
        .neq("status", "posted"),
      supabase
        .from("videos")
        .select("title, status")
        .is("parked_at", null)
        .in("status", ["in_review", "final_review"])
        .limit(5),
      supabase
        .from("videos")
        .select("title, post_date")
        .neq("status", "posted")
        .not("post_date", "is", null)
        .gte("post_date", new Date().toISOString().slice(0, 10))
        .order("post_date", { ascending: true })
        .limit(5),
    ]);
    const bits = [
      `${active ?? 0} video${active === 1 ? "" : "s"} in the pipeline`,
      stuck?.length ? `${stuck.length} waiting on review (${stuck.map((v) => `"${v.title}"`).join(", ")})` : "nothing waiting on review",
      dueSoon?.length ? `${dueSoon.length} with a post date coming up (${dueSoon.map((v) => `"${v.title}"`).join(", ")})` : "nothing scheduled to post soon",
    ];
    return { ok: true, text: bits.join(". ") + "." };
  }

  if (parsed.intent === "how_to") {
    const text = await chatText(
      `You are Andreas, the assistant inside a video content-ops dashboard. Answer the question about how to use ` +
        `the dashboard itself, plainly and briefly (2-4 sentences, or a short numbered list if it's a set of ` +
        `steps) — like a teammate explaining it, not a manual. Only answer from what's given below; if the ` +
        `question is about something not covered, say you're not sure and suggest the closest page it'd live on.`,
      `What the dashboard has:\n${HOW_TO_KNOWLEDGE}\n\nQuestion: "${question}"`
    );
    if (!text) return { ok: false, text: await aiErrorMessage() };
    return { ok: true, text };
  }

  return {
    ok: true,
    text:
      "I can find videos, list them by filter, pull top performers, move a video's stage, tag a teammate, " +
      "reassign an editor, set an ETA, draft a caption, schedule a post, log a new idea, or give you a quick " +
      "report — try rephrasing around one of those.",
  };
}

export type StageTaskKey = "ideation" | "scripting" | "ready_to_film" | "in_review" | "ready_to_post";

// Order when the model has nothing useful to say (no key, or every count is
// zero) — client-blocking stages first, then the stages only the client can move.
const FALLBACK_ORDER: StageTaskKey[] = ["in_review", "ready_to_post", "ready_to_film", "scripting", "ideation"];

/**
 * Which of the five pipeline stages to tackle first — ranked by which
 * actually looks like a bottleneck, not just the biggest number (a big idea
 * shelf is healthy; two reviews stuck for days is not). Titles, counts, and
 * descriptions are all fixed client-side; this only ever returns an order,
 * so a bad ranking is the worst case, never a wrong or invented number.
 */
export async function rankStagesAction(input: {
  counts: Record<StageTaskKey, number>;
  poolRunningDry: boolean;
  activity: { title: string; summary: string }[];
}): Promise<StageTaskKey[]> {
  await requireRole("owner", "admin");

  const present = (Object.keys(input.counts) as StageTaskKey[]).filter((k) => input.counts[k] > 0);
  if (!present.length) return [];

  const countLines = present.map((k) => `- ${k}: ${input.counts[k]}`).join("\n");
  const activityLines = input.activity.map((a) => `- ${a.title}: ${a.summary}`).join("\n");

  const raw = await chatJSON<{ order: StageTaskKey[] }>(
    `You rank pipeline stages in a video content-ops dashboard by which most needs attention right now — a ` +
      `bottleneck, not just the biggest number (a big idea shelf is healthy; two reviews stuck for days is not). ` +
      `Stage keys, in order: ideation (idea shelf) -> scripting (ideas being written) -> ready_to_film -> ` +
      `in_review (client waiting to review a cut) -> ready_to_post (approved, needs scheduling). Only ever use ` +
      `the exact stage keys given, each exactly once — never invent one, never drop one.`,
    `Stages with a count > 0:\n${countLines}\n` +
      `${input.poolRunningDry ? "The editors' pool is about to run dry — more needs to be filmed.\n" : ""}` +
      `Recent activity:\n${activityLines || "nothing new since they were last here"}\n\n` +
      `Respond as JSON: {"order": ["...", ...]}`
  );

  const seen = new Set(present);
  const order = [...new Set((raw?.order ?? []).filter((k) => seen.has(k)))];
  for (const k of present) if (!order.includes(k)) order.push(k);

  return order.length === present.length ? order : FALLBACK_ORDER.filter((k) => seen.has(k));
}
