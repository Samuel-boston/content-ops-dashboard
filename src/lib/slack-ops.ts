import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { chatJSON } from "@/lib/integrations/ai";
import { triageIdea } from "@/lib/intake";
import { CAROUSEL_FORMAT } from "@/lib/taxonomy";
import { slackUserEmail } from "@/lib/integrations/slack";
import { HELP_TEXT, STAGE_LABEL, parseIntent, type SlackIntent, type StageKey } from "@/lib/slack-intent";

const APP_URL = () => (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
const link = (id: string, title: string) => `<${APP_URL()}/videos/${id}|${title.replace(/[<>|]/g, "")}>`;

interface Actor {
  id: string;
  role: string;
  name: string;
}

/** Which stages each seat may ask about — the same walls the dashboard has. */
const VISIBLE: Record<string, StageKey[] | "all"> = {
  owner: "all",
  admin: "all",
  copywriter: ["ideation", "scripting", "ready_to_film"],
  editor: ["ready_to_edit", "in_progress", "revisions", "awaiting_variants"],
  va: ["with_va", "posted"],
};
const ALL_STAGES = Object.keys(STAGE_LABEL) as StageKey[];
const visibleTo = (role: string): StageKey[] => {
  const v = VISIBLE[role];
  return v === "all" ? ALL_STAGES : (v ?? []);
};

/** Who is this Slack user? By the email on their Slack profile, matched to an active seat. */
export async function actorForSlackUser(slackUserId: string): Promise<Actor | null> {
  const email = await slackUserEmail(slackUserId);
  if (!email) return null;
  const { data } = await supabaseAdmin()
    .from("profiles")
    .select("id, role, full_name, email, active")
    .ilike("email", email)
    .maybeSingle();
  if (!data || !data.active) return null;
  return { id: data.id as string, role: data.role as string, name: (data.full_name as string) || (data.email as string) };
}

async function counts(stages: StageKey[]): Promise<Map<StageKey, number>> {
  const { data } = await supabaseAdmin()
    .from("videos")
    .select("status")
    .is("parked_at", null)
    .in("status", stages);
  const out = new Map<StageKey, number>();
  for (const r of data ?? []) out.set(r.status as StageKey, (out.get(r.status as StageKey) ?? 0) + 1);
  return out;
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

async function titlesIn(stage: StageKey, limit = 15) {
  const { data } = await supabaseAdmin()
    .from("videos")
    .select("id, title, formats")
    .is("parked_at", null)
    .eq("status", stage)
    .order("stage_entered_at", { ascending: true })
    .limit(limit + 1);
  return data ?? [];
}

/** An idea from Slack, filed the same way the Telegram bot files one. */
async function addIdea(text: string, actor: Actor): Promise<string> {
  const triage = await triageIdea(text);
  const { data: video, error } = await supabaseAdmin()
    .from("videos")
    .insert({
      title: triage.title,
      brief: triage.brief,
      idea_notes: text,
      needs_script: true,
      status: "ideation",
      priority: "standard",
      ...(triage.carousel ? { formats: [CAROUSEL_FORMAT] } : {}),
    })
    .select("id")
    .single();
  if (error || !video) return `I couldn't save that: ${error?.message ?? "unknown error"}`;
  await supabaseAdmin().from("automation_events").insert({
    kind: "slack_idea_intake",
    video_id: video.id,
    detail: { by: actor.id },
  });
  return `💡 Parked in *Ideation*${triage.carousel ? " as a carousel" : ""}: ${link(video.id as string, triage.title)}`;
}

async function run(intent: SlackIntent, actor: Actor): Promise<string> {
  const db = supabaseAdmin();
  const visible = visibleTo(actor.role);

  switch (intent.kind) {
    case "help":
      return `Hi ${actor.name.split(" ")[0]}! ${HELP_TEXT}`;

    case "add_idea":
      if (!["owner", "admin", "copywriter"].includes(actor.role)) {
        return "Ideas are added by the owner, admins and copywriter. Ask one of them to add it.";
      }
      return addIdea(intent.text, actor);

    case "count": {
      if (intent.stage) {
        if (!visible.includes(intent.stage)) return `${STAGE_LABEL[intent.stage]} isn't something your seat can see.`;
        const n = (await counts([intent.stage])).get(intent.stage) ?? 0;
        return `*${plural(n, "video")}* in ${STAGE_LABEL[intent.stage]}.`;
      }
      const c = await counts(visible);
      const lines = visible
        .filter((s) => s !== "posted")
        .map((s) => `• ${STAGE_LABEL[s]}: *${c.get(s) ?? 0}*`);
      return `*The pipeline right now*\n${lines.join("\n")}`;
    }

    case "list": {
      const stage = intent.stage as StageKey;
      if (!visible.includes(stage)) return `${STAGE_LABEL[stage]} isn't something your seat can see.`;
      const rows = await titlesIn(stage);
      if (!rows.length) return `Nothing in ${STAGE_LABEL[stage]} right now.`;
      const shown = rows.slice(0, 15).map((r) => `• ${link(r.id as string, r.title as string)}`);
      const more = rows.length > 15 ? `\n…and more — open the board to see all of them.` : "";
      return `*${STAGE_LABEL[stage]}* (${rows.length > 15 ? "15+" : rows.length})\n${shown.join("\n")}${more}`;
    }

    case "top": {
      const { data } = await db
        .from("top_posts")
        .select("topic, hook, views, link")
        .order("views", { ascending: false, nullsFirst: false })
        .limit(5);
      if (!data?.length) return "The Top posts list is empty. Add some in Library → Top posts.";
      const fmt = (n: number | null) => (n === null ? "?" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
      return `*Top posts*\n` + data.map((r) => `• *${fmt(r.views as number | null)}* ${r.link ? `<${r.link}|${String(r.topic).replace(/[<>|]/g, "")}>` : String(r.topic).replace(/[<>|]/g, "")}${r.hook ? ` — “${String(r.hook).replace(/[<>|]/g, "")}”` : ""}`).join("\n");
    }

    case "find": {
      const q = intent.query.replace(/[%,()]/g, " ").trim();
      if (!q) return "Find what? Try `find burnout`.";
      const { data } = await db
        .from("videos")
        .select("id, title, status")
        .ilike("title", `%${q}%`)
        .in("status", visible)
        .order("updated_at", { ascending: false })
        .limit(8);
      if (!data?.length) return `Nothing matches “${intent.query}”.`;
      return data
        .map((r) => `• ${link(r.id as string, r.title as string)} — ${STAGE_LABEL[r.status as StageKey] ?? r.status}`)
        .join("\n");
    }

    case "move": {
      if (!["owner", "admin"].includes(actor.role)) return "Only the owner and admins can move a video.";
      if (!["ideation", "scripting", "ready_to_film"].includes(intent.stage)) {
        return "From Slack I can move ideas between Ideation, Scripting and Ready to Film. Approvals and the rest happen in the dashboard.";
      }
      const q = intent.query.replace(/[%,()]/g, " ").trim();
      const { data } = await db
        .from("videos")
        .select("id, title, status, formats")
        .ilike("title", `%${q}%`)
        .in("status", ["ideation", "scripting", "ready_to_film"])
        .is("parked_at", null)
        .limit(4);
      if (!data?.length) return `I couldn't find a planning-stage video called “${intent.query}”.`;
      if (data.length > 1) return `More than one matches “${intent.query}”:\n${data.map((r) => `• ${r.title}`).join("\n")}\nBe a bit more specific.`;
      const v = data[0];
      if (v.status === intent.stage) return `${link(v.id as string, v.title as string)} is already in ${STAGE_LABEL[intent.stage]}.`;
      const { error } = await db.from("videos").update({ status: intent.stage }).eq("id", v.id);
      if (error) return `That didn't work: ${error.message}`;
      await db.from("video_activity").insert({
        video_id: v.id,
        actor_id: actor.id,
        kind: "status",
        summary: `Moved ${v.status} → ${intent.stage} (via Slack)`,
      });
      return `✅ Moved ${link(v.id as string, v.title as string)} to *${STAGE_LABEL[intent.stage]}*.`;
    }

    case "unknown": {
      // One try at understanding it in plain words, if an AI key is set. It only
      // ever picks one of the same intents above — it never invents an action.
      const ai = await chatJSON<{ intent?: string; stage?: string; text?: string; query?: string }>(
        "You route short Slack messages for a video content dashboard. Pick exactly one intent.",
        `Message: """${intent.text.slice(0, 500)}"""\n\nRespond as JSON: {"intent": "add_idea" | "count" | "list" | "find" | "none", "stage": one of ${ALL_STAGES.join(", ")} or "", "text": "the idea text if add_idea", "query": "search words if find"}\nUse "add_idea" only if the person clearly wants to save an idea. Otherwise use "none".`
      );
      if (ai?.intent === "add_idea" && ai.text?.trim()) return run({ kind: "add_idea", text: ai.text.trim() }, actor);
      if ((ai?.intent === "count" || ai?.intent === "list") && ai.stage && (ALL_STAGES as string[]).includes(ai.stage)) {
        return run(ai.intent === "count" ? { kind: "count", stage: ai.stage as StageKey } : { kind: "list", stage: ai.stage as StageKey }, actor);
      }
      if (ai?.intent === "find" && ai.query?.trim()) return run({ kind: "find", query: ai.query.trim() }, actor);
      return `I didn't catch that. ${HELP_TEXT}`;
    }
  }
}

/** Everything a Slack message can do, from raw text and the Slack user who sent it. */
export async function handleSlackText(rawText: string, slackUserId: string): Promise<string> {
  const actor = await actorForSlackUser(slackUserId);
  if (!actor) {
    return "I don't recognise you yet. Ask the owner to add the email on your Slack profile as a seat in the dashboard (Team → Seats), then try again.";
  }
  try {
    return await run(parseIntent(rawText), actor);
  } catch (e) {
    return `Something went wrong on my side: ${(e as Error).message}`;
  }
}
