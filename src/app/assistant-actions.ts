"use server";

import { supabaseServer } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { chatJSON, aiErrorMessage } from "@/lib/integrations/ai";
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

  return {
    ok: true,
    text:
      "I can find videos, list them by filter, pull top performers, move a video's stage, tag a teammate, " +
      "reassign an editor, set an ETA, draft a caption, schedule a post, log a new idea, or give you a quick " +
      "report — try rephrasing around one of those.",
  };
}

export interface OverviewPick {
  id: string;
  title: string;
  status: VideoStatus;
  label: string;
  href: string;
}

export interface OverviewOpener {
  opener: string;
  picks: OverviewPick[];
}

export interface OverviewItemInput {
  id: string;
  title: string;
  status: VideoStatus;
  kind: "final_review" | "review" | "ready_to_post" | "to_film";
}

const KIND_LABEL: Record<OverviewItemInput["kind"], string> = {
  final_review: "Needs your final review",
  review: "Waiting on your review",
  ready_to_post: "Ready to post",
  to_film: "Scripted, ready to film",
};

const KIND_PRIORITY: OverviewItemInput["kind"][] = ["final_review", "review", "ready_to_post", "to_film"];

const OPENER_POOL = [
  "Okay, what are we working on?",
  "Here's where things stand.",
  "Let's see what needs you.",
  "Here's what's on deck.",
];

function fallbackOpener(hasItems: boolean): string {
  if (!hasItems) return "You're all caught up — nothing needs you right now.";
  return OPENER_POOL[Math.floor(Math.random() * OPENER_POOL.length)];
}

function fallbackPicks(items: OverviewItemInput[]): OverviewPick[] {
  return [...items]
    .sort((a, b) => KIND_PRIORITY.indexOf(a.kind) - KIND_PRIORITY.indexOf(b.kind))
    .slice(0, 4)
    .map((it) => ({ id: it.id, title: it.title, status: it.status, label: KIND_LABEL[it.kind], href: `/videos/${it.id}` }));
}

/**
 * The top of the Overview report — Andreas opens with one short line, then
 * picks a handful of real items worth looking at first, each a clickable
 * link, instead of a paragraph to read. The model only ever chooses among
 * and labels the exact items handed to it; every returned id is checked
 * against that same list before it's allowed to become a link, so a
 * hallucinated id can never reach the page — it just falls out of the list.
 */
export async function overviewOpenerAction(input: {
  firstName: string;
  items: OverviewItemInput[];
  poolRunningDry: boolean;
  activity: { title: string; summary: string }[];
}): Promise<OverviewOpener> {
  await requireRole("owner", "admin");

  const byId = new Map(input.items.map((it) => [it.id, it]));

  if (!input.items.length) {
    return { opener: fallbackOpener(false), picks: [] };
  }

  const itemLines = input.items.map((it) => `- id:${it.id} | "${it.title}" | ${KIND_LABEL[it.kind]}`).join("\n");
  const activityLines = input.activity.map((a) => `- ${a.title}: ${a.summary}`).join("\n");

  const raw = await chatJSON<{ opener: string; picks: { id: string; label: string }[] }>(
    `You are Andreas, the assistant inside a video content-ops dashboard, speaking directly to the person who ` +
      `just opened it — casual, like a colleague checking in, not a formal report. Write ONE short opener line ` +
      `(max 8 words, no greeting — that's handled elsewhere, e.g. "Okay, what are we working on?") and then pick ` +
      `up to 4 of the items below that matter most right now, each with a short punchy label (max 8 words) saying ` +
      `why it matters. Only ever use the exact "id" values given — never invent one, never invent a title or ` +
      `detail that isn't given to you.`,
    `${input.firstName ? `Their name: ${input.firstName}.\n` : ""}` +
      `Items needing their input:\n${itemLines}\n` +
      `${input.poolRunningDry ? "The editors' pool is about to run dry — more needs to be filmed.\n" : ""}` +
      `Recent activity:\n${activityLines || "nothing new since they were last here"}\n\n` +
      `Respond as JSON: {"opener": "...", "picks": [{"id": "...", "label": "..."}]}`
  );

  const picks = raw?.picks
    ?.filter((p) => byId.has(p.id))
    .slice(0, 4)
    .map((p) => {
      const it = byId.get(p.id)!;
      return { id: it.id, title: it.title, status: it.status, label: p.label || KIND_LABEL[it.kind], href: `/videos/${it.id}` };
    });

  if (raw?.opener && picks?.length) {
    return { opener: raw.opener, picks };
  }
  return { opener: fallbackOpener(true), picks: fallbackPicks(input.items) };
}
