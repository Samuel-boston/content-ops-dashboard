"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentProfile, requireRole, requireUser } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { displayName } from "@/lib/format";
import { NUDGES, type NudgeKind } from "@/lib/nudges";
import { previousStage, type VideoStatus } from "@/lib/types";
import { isCarouselFormat } from "@/lib/taxonomy";

function revalidateAll(videoId?: string) {
  for (const p of [
    "/",
    "/board",
    "/queue",
    "/ready-to-edit",
    "/review",
    "/ideation",
    "/scripting",
    "/ready-to-post",
    "/calendar",
    "/team",
  ]) {
    revalidatePath(p);
  }
  if (videoId) revalidatePath(`/videos/${videoId}`);
}

// ---------------------------------------------------------------------------
// ETAs
// ---------------------------------------------------------------------------

/**
 * Pick up a video and commit to a delivery date in one step.
 *
 * The ETA is the whole point of the claim dialog: the client's original
 * complaint was never knowing when anything would land, so taking work on
 * without saying when is not an option the UI offers.
 */
export async function claimVideoAction(videoId: string, etaISO: string) {
  const me = await requireUser();
  if (!etaISO) return { error: "Give the client a delivery date." };

  const eta = new Date(etaISO);
  if (Number.isNaN(eta.getTime())) return { error: "That date didn't parse." };

  const supabase = await supabaseServer();
  const { data: before } = await supabase
    .from("videos")
    .select("title, status, assigned_editor_id")
    .eq("id", videoId)
    .maybeSingle();
  if (!before) return { error: "Not found." };
  if (before.assigned_editor_id && before.assigned_editor_id !== me.id) {
    return { error: "Someone else is already on this one." };
  }

  // Two writes, deliberately.
  //
  // Assigning a video flips ready_to_edit → in_progress inside the database
  // (t10_videos_assignment_sync), and a later trigger in that same chain
  // clears the ETA whenever the stage changes — an ETA promised for one stage
  // shouldn't quietly follow the video into the next. Sending assignment and
  // the promised date together therefore lost the date every single time: the
  // dialog asked for it, the editor picked it, and the trigger wiped it before
  // the row landed.
  //
  // So: assign first, then record the promise against the stage the video
  // actually ended up in. The second write doesn't touch status, so nothing
  // clears it. Reading the stage back also beats predicting it — the database
  // decides where an assignment lands, not this function.
  const { data: assigned, error: assignError } = await supabase
    .from("videos")
    .update({ assigned_editor_id: me.id })
    .eq("id", videoId)
    .select("status")
    .maybeSingle();
  if (assignError) return { error: assignError.message };

  const { error } = await supabase
    .from("videos")
    .update({
      eta_at: eta.toISOString(),
      eta_stage: (assigned?.status as VideoStatus) ?? "in_progress",
      eta_set_by: me.id,
      eta_set_at: new Date().toISOString(),
    })
    .eq("id", videoId);
  if (error) return { error: error.message };

  revalidateAll(videoId);
  return { ok: true };
}

/**
 * Update or (re)commit an ETA without changing assignment — used when an
 * editor takes on revisions or hook variants, and when a date slips.
 */
export async function setEtaAction(videoId: string, etaISO: string) {
  const me = await requireUser();
  const supabase = await supabaseServer();

  const { data: v } = await supabase
    .from("videos")
    .select("title, status, eta_at, assigned_editor_id")
    .eq("id", videoId)
    .maybeSingle();
  if (!v) return { error: "Not found." };

  const eta = etaISO ? new Date(etaISO) : null;
  if (etaISO && Number.isNaN(eta!.getTime())) return { error: "That date didn't parse." };

  const { error } = await supabase
    .from("videos")
    .update({
      eta_at: eta ? eta.toISOString() : null,
      eta_stage: eta ? (v.status as VideoStatus) : null,
      eta_set_by: eta ? me.id : null,
      eta_set_at: eta ? new Date().toISOString() : null,
    })
    .eq("id", videoId);
  if (error) return { error: error.message };

  // A date that moves after one was already promised is worth surfacing.
  if (v.eta_at && eta && new Date(v.eta_at).getTime() !== eta.getTime()) {
    const { data: owners } = await supabase
      .from("profiles")
      .select("id")
      .in("role", ["owner", "admin"])
      .eq("active", true);
    await notify({
      userIds: (owners ?? []).map((o) => o.id).filter((id) => id !== me.id),
      kind: "system",
      title: `New ETA on “${v.title}”`,
      body: `${displayName(me)} moved delivery to ${eta.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      })}.`,
      link: `/videos/${videoId}`,
      videoId,
      email: false,
    });
  }

  revalidateAll(videoId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Nudge
// ---------------------------------------------------------------------------

export async function nudgeAction(videoId: string, kind: NudgeKind) {
  const me = await requireRole("owner", "admin");
  const body = NUDGES[kind];
  if (!body) return { error: "Unknown nudge." };

  const supabase = await supabaseServer();
  const { data: v } = await supabase
    .from("videos")
    .select("title, assigned_editor_id")
    .eq("id", videoId)
    .maybeSingle();
  if (!v) return { error: "Not found." };

  const { error } = await supabase
    .from("video_messages")
    .insert({ video_id: videoId, author_id: me.id, body, mentions: [] });
  if (error) return { error: error.message };

  if (v.assigned_editor_id) {
    await notify({
      userIds: [v.assigned_editor_id],
      kind: "comment",
      title: `${displayName(me)} asked about “${v.title}”`,
      body,
      link: `/videos/${videoId}`,
      videoId,
    });
  }

  revalidatePath(`/videos/${videoId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Stage moves
// ---------------------------------------------------------------------------

/**
 * Editor hands work back to the client. Which review it lands in depends on
 * what was being worked on: a fresh cut or revisions go to In Review; hook
 * variants go to Final Review.
 */
export async function submitForReviewAction(videoId: string) {
  await requireUser();
  const supabase = await supabaseServer();
  const { data: v } = await supabase
    .from("videos")
    .select("status, title")
    .eq("id", videoId)
    .maybeSingle();
  if (!v) return { error: "Not found." };

  const next: VideoStatus | null =
    v.status === "awaiting_variants"
      ? "final_review"
      : v.status === "in_progress" || v.status === "revisions"
        ? "in_review"
        : null;
  if (!next) return { error: `Nothing to submit from ${v.status}.` };

  const { error } = await supabase.from("videos").update({ status: next }).eq("id", videoId);
  if (error) return { error: error.message };

  const { data: managers } = await supabase
    .from("profiles")
    .select("id")
    .in("role", ["owner", "admin"])
    .eq("active", true);
  const me = await getCurrentProfile();
  await notify({
    userIds: (managers ?? []).map((m) => m.id),
    kind: "system",
    title: `“${v.title}” is ready for you to review`,
    body: me ? `${displayName(me)} submitted it.` : undefined,
    link: `/videos/${videoId}`,
    videoId,
  });

  revalidateAll(videoId);
  return { ok: true };
}

/**
 * Client approves. A DB trigger decides where it goes next: Awaiting Variants
 * when the script has more than one hook, otherwise straight to Ready to Post.
 * `needsVariants` is the client's explicit override at approval time.
 */
export async function approveAction(videoId: string, needsVariants?: boolean | null) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();

  if (needsVariants !== undefined) {
    const { error: oErr } = await supabase
      .from("videos")
      .update({ variants_override: needsVariants })
      .eq("id", videoId);
    if (oErr) return { error: oErr.message };
  }

  const { error } = await supabase.from("videos").update({ status: "approved" }).eq("id", videoId);
  if (error) return { error: error.message };

  const { data: after } = await supabase
    .from("videos")
    .select("status, title, assigned_editor_id")
    .eq("id", videoId)
    .maybeSingle();

  // Variants are the editor's next job, so tell them the ball's back.
  if (after?.status === "awaiting_variants" && after.assigned_editor_id) {
    await notify({
      userIds: [after.assigned_editor_id],
      kind: "system",
      title: `Approved — “${after.title}” needs its hook variants`,
      link: `/videos/${videoId}`,
      videoId,
    });
  }

  revalidateAll(videoId);
  return { ok: true, status: after?.status as VideoStatus | undefined };
}

/** Client sends a cut back with notes. */
export async function requestRevisionsAction(videoId: string) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { error } = await supabase.from("videos").update({ status: "revisions" }).eq("id", videoId);
  if (error) return { error: error.message };
  revalidateAll(videoId);
  return { ok: true };
}

/** Move an idea along the client's private planning stages. */
export async function setPlanningStageAction(videoId: string, status: VideoStatus) {
  const me = await requireRole("owner", "admin", "copywriter");
  if (!["ideation", "scripting", "script_review", "ready_to_film", "editor_brief", "ready_to_edit"].includes(status)) {
    return { error: "Not a planning stage." };
  }
  // Mirrors the DB guard (migration 027): a copywriter moves scripts between
  // Idea / Scripting / Script Review — approving one for filming is the
  // client's call. Checked here too so the button fails with words, not SQL.
  if (me.role === "copywriter" && !["ideation", "scripting", "script_review"].includes(status)) {
    return { error: "Approving a script for filming is the client's call." };
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.from("videos").update({ status }).eq("id", videoId);
  if (error) return { error: error.message };
  revalidateAll(videoId);
  return { ok: true };
}

/** Client marks a Ready to Post video as actually posted. */
export async function markPostedAction(videoId: string) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { error } = await supabase.from("videos").update({ status: "posted" }).eq("id", videoId);
  if (error) return { error: error.message };
  revalidateAll(videoId);
  revalidatePath("/archive");
  return { ok: true };
}

/**
 * Put a video back in the Editing Bay.
 *
 * Available to whoever holds it and to the client. An editor who has taken on
 * more than they can finish needs a way to say so that isn't a message nobody
 * acts on, and the client needs to be able to pull work back without deleting
 * and recreating it.
 *
 * Clears the ETA along with the assignment: a promised date belongs to the
 * person who promised it, and leaving it behind would show the next editor a
 * deadline they never agreed to.
 */
export async function returnToBayAction(videoId: string, reason?: string) {
  const me = await requireUser();
  const supabase = await supabaseServer();

  const { data: before } = await supabase
    .from("videos")
    .select("title, status, assigned_editor_id")
    .eq("id", videoId)
    .single();
  if (!before) return { error: "Video not found." };

  const mine = before.assigned_editor_id === me.id;
  const manager = me.role === "owner" || me.role === "admin";
  if (!mine && !manager) return { error: "That isn't yours to hand back." };

  if (before.status === "posted") return { error: "That one's already gone out." };

  const { error } = await supabase
    .from("videos")
    .update({
      assigned_editor_id: null,
      status: "ready_to_edit",
      eta_at: null,
      eta_stage: null,
      eta_set_by: null,
      eta_set_at: null,
    })
    .eq("id", videoId);
  if (error) return { error: error.message };

  await supabase.from("video_activity").insert({
    video_id: videoId,
    actor_id: me.id,
    kind: "assignment",
    summary: reason?.trim()
      ? `Returned to the Editing Bay — ${reason.trim()}`
      : "Returned to the Editing Bay",
  });

  // Tell the client when an editor hands work back; they may need to reassign
  // it. No notification the other way — the client already knows what they did.
  if (mine && !manager) {
    const { data: managers } = await supabase
      .from("profiles")
      .select("id")
      .in("role", ["owner", "admin"])
      .eq("active", true);
    await notify({
      userIds: (managers ?? []).map((m) => m.id as string),
      kind: "assignment",
      title: `“${before.title}” is back in the Editing Bay`,
      body: reason?.trim() || `${me.full_name || me.email} handed it back.`,
      link: `/videos/${videoId}`,
      videoId,
    });
  }

  revalidateAll(videoId);
  revalidatePath("/editing-bay");
  revalidatePath("/my-work");
  return { ok: true };
}

/**
 * Undo the last stage move.
 *
 * Every forward step in this pipeline is one click, so every one of them is a
 * misclick waiting to happen — and before this the only way back was to hunt
 * the video down under its new status and change it by hand. Permissions are
 * unchanged: this goes through the same guard trigger as any other status
 * write, so an editor still can't drag something back into the client's
 * private planning stages.
 */
export async function stepBackStageAction(videoId: string) {
  const me = await requireUser();
  const supabase = await supabaseServer();

  const { data: video } = await supabase
    .from("videos")
    .select("title, status, formats")
    .eq("id", videoId)
    .maybeSingle();
  if (!video) return { error: "Not found." };

  const back = previousStage(video.status as VideoStatus, isCarouselFormat(video.formats));
  if (!back) return { error: "That's the first stage — nothing to go back to." };

  const { error } = await supabase.from("videos").update({ status: back }).eq("id", videoId);
  if (error) return { error: error.message };

  await supabase.from("video_activity").insert({
    video_id: videoId,
    actor_id: me.id,
    kind: "status",
    summary: `Moved back ${video.status} → ${back}`,
  });

  revalidateAll(videoId);
  return { ok: true, to: back };
}

/**
 * Shelve a video for later, or bring it back.
 *
 * A flag rather than a stage, so a parked video keeps its place in the
 * pipeline: something shelved halfway through scripting comes back to
 * scripting with its draft intact, rather than being dumped in Ideation.
 *
 * Parked work is excluded from boards, queues, counts and the runway — the
 * whole point is that it stops making the pipeline look busier than it is.
 */
export async function parkVideoAction(videoId: string, reason?: string) {
  const me = await requireRole("owner", "admin");
  const supabase = await supabaseServer();

  const { data: before } = await supabase
    .from("videos")
    .select("title, status")
    .eq("id", videoId)
    .maybeSingle();
  if (!before) return { error: "Not found." };
  if (before.status === "posted") return { error: "That one's already gone out." };

  const { error } = await supabase
    .from("videos")
    .update({ parked_at: new Date().toISOString(), parked_reason: reason?.trim() || null })
    .eq("id", videoId);
  if (error) return { error: error.message };

  await supabase.from("video_activity").insert({
    video_id: videoId,
    actor_id: me.id,
    kind: "status",
    summary: reason?.trim() ? `Parked for later — ${reason.trim()}` : "Parked for later",
  });

  revalidateAll(videoId);
  revalidatePath("/parked");
  return { ok: true };
}

export async function unparkVideoAction(videoId: string) {
  const me = await requireRole("owner", "admin");
  const supabase = await supabaseServer();

  const { data: before } = await supabase
    .from("videos")
    .select("status")
    .eq("id", videoId)
    .maybeSingle();
  if (!before) return { error: "Not found." };

  const { error } = await supabase
    .from("videos")
    .update({ parked_at: null, parked_reason: null })
    .eq("id", videoId);
  if (error) return { error: error.message };

  await supabase.from("video_activity").insert({
    video_id: videoId,
    actor_id: me.id,
    kind: "status",
    summary: `Picked back up into ${before.status}`,
  });

  revalidateAll(videoId);
  revalidatePath("/parked");
  return { ok: true };
}

/** Everything on the shelf, newest first. */
export async function listParked() {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("videos")
    .select("*, assigned_editor:profiles!videos_assigned_editor_id_fkey (id, full_name, email)")
    .not("parked_at", "is", null)
    .order("parked_at", { ascending: false });
  return (data ?? []) as import("@/lib/types").VideoWithEditor[];
}
