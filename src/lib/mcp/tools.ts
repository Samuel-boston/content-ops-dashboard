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
  ready_to_film: ["ready_to_film"],
  editing: ["in_progress"],
  in_progress: ["in_progress"],
  review: ["in_review"],
  revisions: ["revisions"],
  awaiting_variants: ["awaiting_variants"],
  ready_to_post: ["with_va", "final_review"],
  with_va: ["with_va"],
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
const COPYWRITER_VISIBLE: VideoStatus[] = ["ideation", "scripting", "ready_to_film"];

/** The client's private planning half — invisible to editors (RLS parity). */
const PLANNING: VideoStatus[] = ["ideation", "scripting", "ready_to_film"];

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

export const setStageSchema = z.object({
  video_id: z.string().uuid(),
  stage: z
    .enum(["ideation", "scripting", "ready_to_film"])
    .describe(
      "Where to move it in the planning half: ideation, scripting, or ready_to_film. A copywriter can use " +
        "ideation and scripting only — approving a script for filming (ready_to_film) is the client's call."
    ),
});

/**
 * Move a video between the planning stages. Same rule as the dashboard's own
 * guard: a copywriter moves scripts between Ideation / Scripting; everything
 * else is an owner/admin move.
 */
export async function setStage(profile: Profile, args: z.infer<typeof setStageSchema>) {
  if (!isScriptStaff(profile)) return { error: "Only an owner, admin or copywriter can move a script between stages." };
  const db = supabaseAdmin();
  const { data: v } = await db.from("videos").select("title, status").eq("id", args.video_id).maybeSingle();
  if (!v) return { error: "No video with that id." };
  if (profile.role === "copywriter") {
    if (!COPYWRITER_VISIBLE.includes(v.status as VideoStatus)) {
      return { error: "That video has left the planning stages — it isn't a copywriter's to move." };
    }
    if (!["ideation", "scripting"].includes(args.stage)) {
      return { error: "A copywriter can move a script between Ideation and Scripting — approving it for filming is the client's call." };
    }
  }
  if (v.status === args.stage) return { ok: true, note: "It was already there.", link: videoLink(args.video_id) };
  const { error } = await db.from("videos").update({ status: args.stage }).eq("id", args.video_id);
  if (error) throw new Error(error.message);
  await db.from("video_activity").insert({
    video_id: args.video_id,
    actor_id: profile.id,
    kind: "status",
    summary: `Moved ${v.status} → ${args.stage} (via AI assistant)`,
  });
  return { ok: true, from: v.status, to: args.stage, link: videoLink(args.video_id) };
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

// ---- Top posts ------------------------------------------------------------

export const listTopPostsSchema = z.object({
  query: z.string().optional().describe("Words to look for in the topic, hook or creator."),
  source: z.enum(["own", "inspiration"]).optional().describe("Only the client's own posts, or only inspiration from other accounts."),
  limit: z.number().int().min(1).max(100).optional().describe("How many to return (default 25, best first)."),
});

/** The curated list of top-performing posts, best first. Any seat may read it. */
export async function listTopPosts(_profile: Profile, args: z.infer<typeof listTopPostsSchema>) {
  const db = supabaseAdmin();
  let q = db.from("top_posts").select("id, topic, hook, views, link, platform, creator, format, posted_on, notes, source").order("views", { ascending: false, nullsFirst: false }).limit(args.limit ?? 25);
  if (args.source) q = q.eq("source", args.source);
  if (args.query) {
    const w = args.query.replace(/[%,()]/g, " ").trim();
    if (w) q = q.or(`topic.ilike.%${w}%,hook.ilike.%${w}%,creator.ilike.%${w}%`);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return { posts: data ?? [] };
}

export const addTopPostsSchema = z.object({
  posts: z
    .array(
      z.object({
        topic: z.string().min(1).describe("What the post was about, in a few words."),
        hook: z.string().optional().describe("The exact opening line."),
        views: z.union([z.number(), z.string()]).optional().describe('View count: 120000, "1.2M" or "350k".'),
        link: z.string().optional().describe("Link to the post."),
        platform: z.string().optional().describe("instagram, tiktok, youtube, linkedin, x or other. Worked out from the link when left out."),
        creator: z.string().optional().describe("The account or channel that posted it."),
        format: z.string().optional().describe("reel, short, carousel, long video…"),
        posted_on: z.string().optional().describe("YYYY-MM-DD."),
        notes: z.string().optional().describe("Why it worked."),
        source: z.enum(["own", "inspiration"]).optional().describe('"own" for the client\'s own posts, otherwise "inspiration" (the default).'),
      })
    )
    .min(1)
    .max(50),
});

/**
 * Add posts the user has approved to the Top posts list. Owners and admins only.
 * Posts whose link is already on the list are skipped, so it is safe to repeat.
 */
export async function addTopPosts(profile: Profile, args: z.infer<typeof addTopPostsSchema>) {
  if (!isManager(profile)) return { error: "Only an owner or admin can add to the Top posts list." };
  const { insertTopPosts } = await import("@/lib/top-posts");
  const { parseViews, platformOf } = await import("@/lib/top-posts-parse");
  let res;
  try {
    res = await insertTopPosts(
    args.posts.map((p) => ({
      topic: p.topic,
      hook: p.hook ?? null,
      views: parseViews(p.views ?? null),
      link: p.link ?? null,
      platform: (p.platform?.toLowerCase() || platformOf(p.link)) ?? null,
      creator: p.creator ?? null,
      format: p.format ?? null,
      posted_on: /^\d{4}-\d{2}-\d{2}/.test(p.posted_on ?? "") ? (p.posted_on as string).slice(0, 10) : null,
      notes: p.notes ?? null,
      source: p.source ?? "inspiration",
    })),
    profile.id
  );
  } catch (e) {
    return { error: `Couldn't save those: ${(e as Error).message}` };
  }
  return { ok: true, ...res, link: `${APP_URL}/library/top-posts` };
}

// ---- Playbook (the client's offer, ideal client, SOPs) ----------------------

export const listPlaybookDocsSchema = z.object({});

/** The playbook docs, titles and short previews. Any seat with a token can read them. */
export async function listPlaybookDocs(_profile: Profile, _args?: z.infer<typeof listPlaybookDocsSchema>) {
  const { data, error } = await supabaseAdmin().from("sop_docs").select("id, title, format, body, updated_at").order("position").order("created_at");
  if (error) throw new Error(error.message);
  return {
    docs: (data ?? []).map((d) => ({ id: d.id, title: d.title, format: d.format, updated_at: d.updated_at, preview: String(d.body ?? "").slice(0, 200) })),
    note: "Read a doc in full with get_playbook_doc. Look for the client's offer and ideal client.",
  };
}

export const getPlaybookDocSchema = z.object({ id: z.string().uuid() });

export async function getPlaybookDoc(_profile: Profile, args: { id: string }) {
  const { data, error } = await supabaseAdmin().from("sop_docs").select("id, title, format, body, updated_at").eq("id", args.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { error: "No playbook doc with that id." };
  return { doc: data };
}
