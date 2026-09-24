import "server-only";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "@/lib/notify";
import { CONTENT_PILLARS, FORMATS, PLATFORMS } from "@/lib/taxonomy";
import type { Profile, VideoStatus } from "@/lib/types";

/**
 * Every AI-assistant tool the dashboard exposes over MCP. There is no browser
 * session here — each handler is handed the already-resolved `Profile` for
 * the token that called it (see lib/mcp/auth.ts) and enforces, by hand, the
 * same shape of rule the app's RLS/trigger layer enforces for that role:
 * planning stages stay invisible to editors, editors only ever touch their
 * own assigned videos, a copywriter lives inside the planning stages (and
 * writes scripts there — that's the job), and everything else stays
 * owner/admin. Keep this file as the one place those rules live for the MCP
 * surface — don't duplicate the checks inline at each call site.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://adam-content-ops.vercel.app";
const videoLink = (id: string) => `${APP_URL}/videos/${id}`;

const STAGE_ALIASES: Record<string, VideoStatus[]> = {
  ideas: ["ideation"],
  ideation: ["ideation"],
  ready_to_script: ["scripting"],
  scripting: ["scripting"],
  script_review: ["script_review"],
  ready_to_review: ["script_review"],
  ready_to_film: ["ready_to_film"],
  editing: ["in_progress"],
  in_progress: ["in_progress"],
  review: ["in_review"],
  revisions: ["revisions"],
  awaiting_variants: ["awaiting_variants"],
  ready_to_post: ["ready_to_post", "with_va", "final_review"],
  posted: ["posted"],
};

function isManager(p: Profile) {
  return p.role === "owner" || p.role === "admin";
}

/** Seats that write scripts: managers, and the copywriter (planning half only). */
function isScriptStaff(p: Profile) {
  return isManager(p) || p.role === "copywriter";
}

/** What a copywriter can see — mirrors videos_select_copywriter (migration 027). */
const COPYWRITER_VISIBLE: VideoStatus[] = ["ideation", "scripting", "script_review", "ready_to_film"];

/** The client's private planning half — invisible to editors (RLS parity). */
const PLANNING: VideoStatus[] = ["ideation", "scripting", "script_review", "ready_to_film", "editor_brief"];

const VIDEO_FIELDS =
  "id, title, status, priority, content_pillars, formats, platforms, brief, " +
  "script_body, script_hooks, script_cta, post_date, posted_at, assigned_editor_id, " +
  "created_at, updated_at, editor:profiles!videos_assigned_editor_id_fkey (full_name, email)";

function shapeVideo(v: Record<string, unknown>) {
  const editor = v.editor as { full_name?: string; email?: string } | null;
  return {
    id: v.id,
    title: v.title,
    status: v.status,
    priority: v.priority,
    content_pillars: v.content_pillars,
    formats: v.formats,
    platforms: v.platforms,
    brief: v.brief,
    script_body: v.script_body,
    script_hooks: v.script_hooks,
    script_cta: v.script_cta,
    post_date: v.post_date,
    posted_at: v.posted_at,
    assigned_editor: editor?.full_name || editor?.email || null,
    link: videoLink(v.id as string),
  };
}

export const listVideosSchema = z.object({
  stage: z
    .enum(Object.keys(STAGE_ALIASES) as [string, ...string[]])
    .optional()
    .describe("Pipeline stage to filter to. Omit to search across every stage you can see."),
  query: z.string().optional().describe("Case-insensitive title search."),
  posted_after: z.string().optional().describe("ISO date — only videos posted on/after this date."),
  posted_before: z.string().optional().describe("ISO date — only videos posted on/before this date."),
  limit: z.number().int().min(1).max(50).default(20),
});

export async function listVideos(profile: Profile, args: z.infer<typeof listVideosSchema>) {
  const db = supabaseAdmin();
  let q = db.from("videos").select(VIDEO_FIELDS).order("updated_at", { ascending: false }).limit(args.limit);

  if (profile.role === "copywriter") {
    // The planning half only — the same boundary RLS draws for them in the app.
    q = q.in("status", COPYWRITER_VISIBLE);
  } else if (!isManager(profile)) {
    // Editors never see the client's private planning stages, and only ever
    // their own work — the same boundary RLS draws for them in the app.
    q = q.eq("assigned_editor_id", profile.id).not("status", "in", `(${PLANNING.join(",")})`);
  }
  if (args.stage) q = q.in("status", STAGE_ALIASES[args.stage]);
  if (args.query) q = q.ilike("title", `%${args.query}%`);
  if (args.posted_after) q = q.gte("post_date", args.posted_after);
  if (args.posted_before) q = q.lte("post_date", args.posted_before);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return {
    videos: (data ?? []).map((v) => shapeVideo(v as unknown as Record<string, unknown>)),
  };
}

export const getVideoSchema = z.object({ id: z.string().uuid() });

export async function getVideo(profile: Profile, args: z.infer<typeof getVideoSchema>) {
  const db = supabaseAdmin();
  const { data, error } = await db.from("videos").select(VIDEO_FIELDS).eq("id", args.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { error: "No video with that id." };
  const v = data as unknown as Record<string, unknown>;
  if (profile.role === "copywriter") {
    if (!COPYWRITER_VISIBLE.includes(v.status as VideoStatus)) {
      return { error: "That video has left the planning stages — not visible to a copywriter." };
    }
  } else if (!isManager(profile)) {
    if (v.assigned_editor_id !== profile.id) return { error: "That video isn't assigned to you." };
    if (PLANNING.includes(v.status as VideoStatus)) return { error: "Not visible to editors." };
  }
  return { video: shapeVideo(v) };
}

export const createIdeaSchema = z.object({
  title: z.string().min(1),
  brief: z.string().optional().describe("The idea itself — angle, context, why it'd work."),
  content_pillars: z.array(z.enum(CONTENT_PILLARS)).optional(),
  formats: z.array(z.enum(FORMATS)).optional(),
  platforms: z.array(z.enum(PLATFORMS)).optional(),
});

export async function createIdea(profile: Profile, args: z.infer<typeof createIdeaSchema>) {
  if (!isScriptStaff(profile)) return { error: "Only an owner, admin or copywriter can add ideas." };
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("videos")
    .insert({
      title: args.title,
      status: "ideation",
      brief: args.brief ?? null,
      content_pillars: args.content_pillars ?? [],
      formats: args.formats ?? [],
      platforms: args.platforms ?? [],
      needs_script: true,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, link: videoLink(data.id) };
}

export const saveScriptSchema = z.object({
  video_id: z.string().uuid(),
  script_body: z.string().optional(),
  script_hooks: z.array(z.string()).optional().describe("Replaces the full hook list — pass every hook, not just new ones."),
  script_cta: z.string().optional(),
});

export async function saveScript(profile: Profile, args: z.infer<typeof saveScriptSchema>) {
  if (!isScriptStaff(profile)) return { error: "Only an owner, admin or copywriter can write scripts." };
  const db = supabaseAdmin();
  if (profile.role === "copywriter") {
    // Same fence as RLS: once a video leaves the planning half its script is
    // locked to management.
    const { data: v } = await db.from("videos").select("status").eq("id", args.video_id).maybeSingle();
    if (!v) return { error: "No video with that id." };
    if (!COPYWRITER_VISIBLE.includes(v.status as VideoStatus)) {
      return { error: "That video has left the planning stages — its script is locked." };
    }
  }
  const patch: Record<string, unknown> = {};
  if (args.script_body !== undefined) patch.script_body = args.script_body;
  if (args.script_hooks !== undefined) patch.script_hooks = args.script_hooks;
  if (args.script_cta !== undefined) patch.script_cta = args.script_cta;
  if (Object.keys(patch).length === 0) return { error: "Nothing to save." };

  const { error } = await db.from("videos").update(patch).eq("id", args.video_id);
  if (error) throw new Error(error.message);
  return { ok: true, link: videoLink(args.video_id) };
}

export const addHookVariantsSchema = z.object({
  video_id: z.string().uuid(),
  hooks: z.array(z.string()).min(1),
});

export async function addHookVariants(profile: Profile, args: z.infer<typeof addHookVariantsSchema>) {
  if (!isScriptStaff(profile)) return { error: "Only an owner, admin or copywriter can add hook variants." };
  const db = supabaseAdmin();
  const { data: existing, error: readErr } = await db
    .from("videos")
    .select("script_hooks, status")
    .eq("id", args.video_id)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!existing) return { error: "No video with that id." };
  if (profile.role === "copywriter" && !COPYWRITER_VISIBLE.includes(existing.status as VideoStatus)) {
    return { error: "That video has left the planning stages — its script is locked." };
  }

  const merged = [...new Set([...(existing.script_hooks ?? []), ...args.hooks])];
  const { error } = await db.from("videos").update({ script_hooks: merged }).eq("id", args.video_id);
  if (error) throw new Error(error.message);
  return { ok: true, hooks: merged, link: videoLink(args.video_id) };
}

export const messageEditorSchema = z.object({
  video_id: z.string().uuid(),
  message: z.string().min(1),
});

export async function messageEditor(profile: Profile, args: z.infer<typeof messageEditorSchema>) {
  const db = supabaseAdmin();
  const { data: v } = await db
    .from("videos")
    .select("title, assigned_editor_id, created_by")
    .eq("id", args.video_id)
    .maybeSingle();
  if (!v) return { error: "No video with that id." };
  if (!isManager(profile) && v.assigned_editor_id !== profile.id) {
    return { error: "That video isn't assigned to you." };
  }

  const { error } = await db
    .from("video_messages")
    .insert({ video_id: args.video_id, author_id: profile.id, body: args.message });
  if (error) throw new Error(error.message);

  const recipient = isManager(profile) ? v.assigned_editor_id : v.created_by;
  if (recipient && recipient !== profile.id) {
    await notify({
      userIds: [recipient],
      kind: "mention",
      title: `${profile.full_name || profile.email} sent you a message on "${v.title}"`,
      body: args.message.slice(0, 200),
      link: `/videos/${args.video_id}`,
      videoId: args.video_id,
    });
  }
  return { ok: true, link: videoLink(args.video_id) };
}
