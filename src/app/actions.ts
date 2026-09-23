"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentProfile, requireRole, requireUser } from "@/lib/auth";
import { notify, notifyTelegram } from "@/lib/notify";
import { STATUS_ORDER } from "@/lib/types";
import type {
  Priority,
  Profile,
  Role,
  TaxonomyOption,
  Video,
  VideoStatus,
  VideoWithEditor,
} from "@/lib/types";
import type { TaxonomyKind } from "@/lib/taxonomy";

const EDITOR_SELECT =
  "*, assigned_editor:profiles!videos_assigned_editor_id_fkey (id, full_name, email)";

function revalidateBoards() {
  for (const p of [
    "/",
    "/ready-to-edit",
    "/board",
    "/queue",
    "/calendar",
    "/team",
    "/ideation",
    "/scripting",
    "/review",
    "/ready-to-post",
  ]) {
    revalidatePath(p);
  }
}

/**
 * Automation #3: the moment the Ready to Edit pool hits zero, tell the client
 * (via Telegram) that more needs to be filmed. Debounced so it fires once per
 * empty streak, not on every transition while it stays empty.
 */
async function checkPoolEmpty() {
  const supabase = await supabaseServer();
  const { count } = await supabase
    .from("videos")
    .select("*", { count: "exact", head: true })
    .is("parked_at", null)
    .eq("status", "ready_to_edit");
  if ((count ?? 0) > 0) return;

  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const db = supabaseAdmin();
  const { data: recent } = await db
    .from("automation_events")
    .select("id")
    .eq("kind", "pool_empty_alert")
    .gte("created_at", new Date(Date.now() - 6 * 3600 * 1000).toISOString())
    .maybeSingle();
  if (recent) return;

  await db.from("automation_events").insert({ kind: "pool_empty_alert", detail: {} });
  await notifyTelegram(
    "🎬 <b>Ready to Edit is empty.</b> Nothing left in the pool — more needs to be filmed."
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listEditors(): Promise<Profile[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("role", "editor")
    .eq("active", true)
    .order("full_name");
  return (data as Profile[]) ?? [];
}

export async function listTeam(): Promise<Profile[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("profiles").select("*").order("role").order("full_name");
  return (data as Profile[]) ?? [];
}

export async function listTaxonomyCustoms(): Promise<TaxonomyOption[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("taxonomy_options").select("*").order("value");
  return (data as TaxonomyOption[]) ?? [];
}

export interface ReadyToEditFilters {
  search?: string;
  pillar?: string;
  format?: string;
  platform?: string;
  page?: number;
  pageSize?: number;
}

export async function listReadyToEdit(filters: ReadyToEditFilters = {}): Promise<{
  rows: VideoWithEditor[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const supabase = await supabaseServer();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? 25;

  let query = supabase
    .from("videos")
    .select(EDITOR_SELECT, { count: "exact" })
    .is("parked_at", null)
    .eq("status", "ready_to_edit");

  if (filters.search) query = query.ilike("title", `%${filters.search}%`);
  if (filters.pillar) query = query.contains("content_pillars", [filters.pillar]);
  if (filters.format) query = query.contains("formats", [filters.format]);
  if (filters.platform) query = query.contains("platforms", [filters.platform]);

  // Order by priority in the DATABASE, not after paginating — otherwise an
  // Urgent video on page 3 would never surface above a Standard one on page 1.
  const { data, count } = await query
    .order("priority_rank", { ascending: false })
    .order("created_at", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);

  return { rows: (data as VideoWithEditor[]) ?? [], total: count ?? 0, page, pageSize };
}

export async function listActiveBoard(): Promise<VideoWithEditor[]> {
  const supabase = await supabaseServer();
  // priority_rank, not priority — ordering by the text column sorted
  // alphabetically (high, standard, urgent) and buried Urgent at the bottom.
  // Hand-placed cards (board_position set by a drag) come first in the order
  // they were dropped; everything untouched falls back to priority then age.
  const { data } = await supabase
    .from("videos")
    .select(EDITOR_SELECT)
    .is("parked_at", null)
    .neq("status", "posted")
    .order("board_position", { ascending: true, nullsFirst: false })
    .order("priority_rank", { ascending: false })
    .order("stage_entered_at", { ascending: true });
  return (data as VideoWithEditor[]) ?? [];
}

export async function listMyQueue(): Promise<{ mine: VideoWithEditor[]; pool: VideoWithEditor[] }> {
  const profile = await requireUser();
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("videos")
    .select(EDITOR_SELECT)
    .is("parked_at", null)
    .neq("status", "posted")
    .order("priority_rank", { ascending: false })
    .order("stage_entered_at", { ascending: true });
  const all = (data as VideoWithEditor[]) ?? [];
  return {
    mine: all.filter((v) => v.assigned_editor_id === profile.id),
    pool: all.filter((v) => v.status === "ready_to_edit" && !v.assigned_editor_id),
  };
}

/** Global search (⌘K) — videos the viewer can see, matched on title or brief. */
export async function globalSearch(term: string): Promise<VideoWithEditor[]> {
  await requireUser();
  const q = term.trim();
  if (q.length < 2) return [];
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("videos")
    .select(EDITOR_SELECT)
    .is("parked_at", null)
    .or(`title.ilike.%${q}%,brief.ilike.%${q}%`)
    .order("priority_rank", { ascending: false })
    .limit(20);
  return (data as VideoWithEditor[]) ?? [];
}

export async function getVideo(id: string): Promise<VideoWithEditor | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("videos").select(EDITOR_SELECT).eq("id", id).maybeSingle();
  return (data as VideoWithEditor | null) ?? null;
}

export async function stageCounts(): Promise<Record<VideoStatus, number>> {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("videos").select("status").is("parked_at", null);
  // Seeded from STATUS_ORDER rather than a literal, so a new stage can't quietly
  // land here as undefined and turn every count into NaN.
  const counts = Object.fromEntries(
    [...STATUS_ORDER, "approved"].map((s) => [s, 0])
  ) as Record<VideoStatus, number>;
  for (const row of (data as { status: VideoStatus }[]) ?? []) {
    if (counts[row.status] !== undefined) counts[row.status] += 1;
  }
  return counts;
}

export async function calendarVideos(fromISO: string, toISO: string): Promise<VideoWithEditor[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("videos")
    .select(EDITOR_SELECT)
    .is("parked_at", null)
    .not("post_date", "is", null)
    .gte("post_date", fromISO)
    .lte("post_date", toISO)
    .order("post_date");
  return (data as VideoWithEditor[]) ?? [];
}

// ---------------------------------------------------------------------------
// Video mutations  (RLS + guard trigger are the real enforcement; the role
// checks here are just for clearer errors / fewer round-trips)
// ---------------------------------------------------------------------------

/**
 * Create a video with everything already on it. The old version took only a
 * title, priority and note, which meant every new video had to be opened and
 * filled in a second time before it was usable.
 */
export async function createVideoAction(formData: FormData) {
  const profile = await requireRole("owner", "admin");

  const status = String(formData.get("status") || "") as VideoStatus;
  if (!["ideation", "scripting", "ready_to_film", "ready_to_edit"].includes(status)) {
    return { error: "Pick where the video's at before creating it." };
  }

  const list = (key: string) =>
    formData
      .getAll(key)
      .map((v) => String(v).trim())
      .filter(Boolean);

  // Ideation can start title-less — a voice note or a line of notes is
  // enough to hold its place until it's worth naming.
  const rawTitle = String(formData.get("title") || "").trim();
  const title = rawTitle || (status === "ideation" ? "Untitled idea" : "");
  if (!title) return { error: "Title is required." };

  const editorId = String(formData.get("assigned_editor_id") || "").trim();
  const postDate = String(formData.get("post_date") || "").trim();

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("videos")
    .insert({
      title,
      status,
      priority: (String(formData.get("priority") || "standard") as Priority) ?? "standard",
      brief: String(formData.get("brief") || "").trim() || null,
      content_pillars: list("content_pillars"),
      formats: list("formats"),
      platforms: list("platforms"),
      post_date: postDate || null,
      // Ideation and Scripting videos still need a script written; Ready to
      // Edit ones were created with one already (or don't need one) — no
      // reason to make this a manual toggle when the status already says it.
      needs_script: status === "ideation" || status === "scripting",
      // Only Ready to Edit can carry an editor — planning stages are private.
      assigned_editor_id: status === "ready_to_edit" && editorId ? editorId : null,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  if (status === "ready_to_edit" && editorId) {
    const { data: v } = await supabase.from("videos").select("title").eq("id", data.id).single();
    await notify({
      userIds: [editorId],
      kind: "assignment",
      title: `You've been assigned “${v?.title ?? title}”`,
      link: `/videos/${data.id}`,
      videoId: data.id,
    });
  }

  revalidateBoards();
  return { ok: true, id: data.id as string };
}

export async function updateVideoAction(
  id: string,
  patch: Partial<
    Pick<
      Video,
      | "title"
      | "status"
      | "priority"
      | "post_date"
      | "frameio_url"
      | "brief"
      | "needs_script"
      | "content_pillars"
      | "formats"
      | "platforms"
      | "script_hooks"
      | "script_body"
      | "script_cta"
      | "raw_footage_url"
    >
  >
) {
  await requireUser();
  const supabase = await supabaseServer();
  const { error } = await supabase.from("videos").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidateBoards();
  revalidatePath(`/videos/${id}`);
  return { ok: true };
}

export async function assignEditorAction(id: string, editorId: string | null) {
  const profile = await requireUser();
  // Editors may only assign to themselves or unassign themselves — the guard
  // trigger enforces this too, this is just a friendlier early error.
  if (profile.role === "editor" && editorId && editorId !== profile.id) {
    return { error: "Editors can only pick up a video for themselves." };
  }
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("videos")
    .update({ assigned_editor_id: editorId })
    .eq("id", id);
  if (error) return { error: error.message };

  // Tell an editor they've been handed a video (unless they picked it themselves).
  if (editorId && editorId !== profile.id) {
    const { data: v } = await supabase.from("videos").select("title").eq("id", id).single();
    await notify({
      userIds: [editorId],
      kind: "assignment",
      title: `You've been assigned “${v?.title ?? "a video"}”`,
      link: `/videos/${id}`,
      videoId: id,
    });
  }
  void checkPoolEmpty();
  revalidateBoards();
  revalidatePath(`/videos/${id}`);
  return { ok: true };
}

export async function setPriorityAction(id: string, priority: Priority) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { error } = await supabase.from("videos").update({ priority }).eq("id", id);
  if (error) return { error: error.message };
  revalidateBoards();
  revalidatePath(`/videos/${id}`);
  return { ok: true };
}

export async function setStatusAction(id: string, status: VideoStatus) {
  const me = await requireUser();
  const supabase = await supabaseServer();
  const { data: before } = await supabase
    .from("videos")
    .select("assigned_editor_id, title, status")
    .eq("id", id)
    .single();
  const { error } = await supabase.from("videos").update({ status }).eq("id", id);
  if (error) return { error: error.message };

  // Sending a video back for revisions pings the editor it's assigned to.
  if (status === "revisions" && before?.assigned_editor_id && before.assigned_editor_id !== me.id) {
    await notify({
      userIds: [before.assigned_editor_id],
      kind: "revision",
      title: `Revisions requested on “${before.title}”`,
      link: `/videos/${id}`,
      videoId: id,
    });
  }

  // When a video is posted, move its cut file(s) out of Cloudflare Stream and
  // into Google Drive, then point the record at Drive — keeping Stream's working
  // set small and flat forever. Best-effort; runs only if Drive is configured.
  if (status === "posted" && before?.status !== "posted") {
    // after(): on a serverless host a bare floating promise is frozen the
    // moment the response is sent, so the copy to Drive would silently never run.
    after(() => archivePostedToDrive(id));
    await notifyTelegram(`✅ Posted: <b>${before?.title ?? "a video"}</b>`);
  }
  if (before?.status === "ready_to_edit" && status !== "ready_to_edit") void checkPoolEmpty();

  revalidateBoards();
  revalidatePath(`/videos/${id}`);
  return { ok: true };
}

async function archivePostedToDrive(videoId: string) {
  try {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    const { uploadFromUrl } = await import("@/lib/integrations/drive");
    const { getDownloadUrl } = await import("@/lib/integrations/stream");
    const { deleteStreamVideo } = await import("@/lib/integrations/stream");
    const db = supabaseAdmin();
    const { data: video } = await db.from("videos").select("title").eq("id", videoId).single();
    const { data: cuts } = await db.from("video_cuts").select("id, label").eq("video_id", videoId);
    let firstLink: string | null = null;
    for (const cut of cuts ?? []) {
      const { data: top } = await db
        .from("cut_versions")
        .select("id, stream_uid, version")
        .eq("cut_id", cut.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!top?.stream_uid) continue;
      const dl = await getDownloadUrl(top.stream_uid);
      if (!dl) continue;
      const link = await uploadFromUrl(dl, `${video?.title ?? "video"} — ${cut.label} v${top.version}.mp4`);
      firstLink ??= link;
      await db.from("cut_versions").update({ drive_file_url: link }).eq("id", top.id);
      await deleteStreamVideo(top.stream_uid);
    }
    if (firstLink) await db.from("videos").update({ drive_file_url: firstLink }).eq("id", videoId);
  } catch {
    /* Drive not configured, or transient failure — leave the file in Stream. */
  }
}

export async function deleteVideoAction(id: string) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { error } = await supabase.from("videos").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateBoards();
  return { ok: true };
}

export async function addTaxonomyOptionAction(kind: TaxonomyKind, value: string) {
  await requireUser();
  const v = value.trim();
  if (!v) return { error: "Empty value." };
  const profile = await getCurrentProfile();
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("taxonomy_options")
    .upsert({ kind, value: v, created_by: profile?.id ?? null }, { onConflict: "kind,value" });
  if (error) return { error: error.message };
  revalidateBoards();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Team management
// ---------------------------------------------------------------------------

export async function inviteUserAction(formData: FormData) {
  const me = await requireRole("owner", "admin");
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const full_name = String(formData.get("full_name") || "").trim();
  const role = String(formData.get("role") || "editor") as Role;
  const password = String(formData.get("password") || "").trim();

  if (!email || !full_name) return { error: "Name and email are required." };
  if (!password || password.length < 8) return { error: "Set a temporary password (8+ chars)." };
  if (role === "owner") return { error: "There can only be one Owner." };
  if (role === "admin" && me.role !== "owner") return { error: "Only the Owner can add Admin seats." };

  const admin = supabaseAdmin();
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role, full_name },
  });
  if (error) return { error: error.message };
  revalidatePath("/team");
  return { ok: true };
}

export async function setUserRoleAction(userId: string, role: Role) {
  const me = await requireRole("owner", "admin");
  if (role === "owner") return { error: "The Owner seat can't be reassigned here." };
  if (role === "admin" && me.role !== "owner") return { error: "Only the Owner can grant Admin." };

  const supabase = await supabaseServer();
  const { data: target } = await supabase.from("profiles").select("role").eq("id", userId).single();
  if (target?.role === "owner") return { error: "Can't change the Owner's role." };
  if (target?.role === "admin" && me.role !== "owner") {
    return { error: "Only the Owner can change an Admin's role." };
  }

  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/team");
  return { ok: true };
}

export async function setUserActiveAction(userId: string, active: boolean) {
  const me = await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { data: target } = await supabase.from("profiles").select("role").eq("id", userId).single();
  if (target?.role === "owner") return { error: "The Owner can't be deactivated." };
  if (target?.role === "admin" && me.role !== "owner") {
    return { error: "Only the Owner can deactivate an Admin." };
  }
  const { error } = await supabase.from("profiles").update({ active }).eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/team");
  return { ok: true };
}

export async function updateOwnNameAction(formData: FormData) {
  const me = await requireUser();
  const full_name = String(formData.get("full_name") || "").trim();
  if (!full_name) return { error: "Name can't be empty." };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("profiles").update({ full_name }).eq("id", me.id);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function signOutAction() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
