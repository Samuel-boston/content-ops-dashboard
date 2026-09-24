"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { mirrorCutOriginalToDrive } from "@/lib/cut-files";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentProfile, requireRole, requireUser } from "@/lib/auth";
import { createDirectUpload, deleteStreamVideo, getStreamVideo, getDownloadUrl } from "@/lib/integrations/stream";
import { notify, resolveMentions } from "@/lib/notify";
import { transcribeWithTimestamps } from "@/lib/integrations/whisper";
import type {
  CommentAttachment,
  CommentVisibility,
  CutComment,
  CutTranscript,
  CutVersion,
  CutWithVersions,
  Drawing,
  TranscriptCue,
  VideoCut,
} from "@/lib/types";

async function assertCanSeeVideo(videoId: string) {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("videos").select("id, title").eq("id", videoId).maybeSingle();
  if (!data) throw new Error("Not found");
  return data as { id: string; title: string };
}

// ---------------------------------------------------------------------------
// Cuts (main + hook variants)
// ---------------------------------------------------------------------------

export async function listCuts(videoId: string): Promise<CutWithVersions[]> {
  const supabase = await supabaseServer();
  const { data: cuts } = await supabase
    .from("video_cuts")
    .select("*")
    .eq("video_id", videoId)
    .order("position");
  const { data: versions } = await supabase
    .from("cut_versions")
    .select("*")
    .in("cut_id", (cuts ?? []).map((c) => c.id))
    .order("version", { ascending: false });

  return ((cuts as VideoCut[]) ?? []).map((c) => ({
    ...c,
    versions: ((versions as CutVersion[]) ?? []).filter((v) => v.cut_id === c.id),
  }));
}

/**
 * Which of these videos' main cut already has at least one uploaded version.
 *
 * Built for the editor's task board: an `in_progress` video is either "needs
 * a first cut delivered" or "still editing, draft already up" depending on
 * this one bit, and there's no column on `videos` that says so directly —
 * only the cuts/versions tables know. Two queries rather than a nested
 * embed, matching `listCuts` above: cut ids for the batch, then which of
 * those ids have any version at all.
 */
export async function mainCutStatusByVideoIds(videoIds: string[]): Promise<Set<string>> {
  if (videoIds.length === 0) return new Set();
  const supabase = await supabaseServer();
  const { data: cuts } = await supabase
    .from("video_cuts")
    .select("id, video_id")
    .eq("kind", "main")
    .in("video_id", videoIds);
  const cutRows = (cuts as { id: string; video_id: string }[]) ?? [];
  if (cutRows.length === 0) return new Set();

  const { data: versions } = await supabase
    .from("cut_versions")
    .select("cut_id")
    .in(
      "cut_id",
      cutRows.map((c) => c.id)
    );
  const cutIdsWithVersion = new Set(((versions as { cut_id: string }[]) ?? []).map((v) => v.cut_id));

  const withCut = new Set<string>();
  for (const c of cutRows) {
    if (cutIdsWithVersion.has(c.id)) withCut.add(c.video_id);
  }
  return withCut;
}

export async function addHookVariantAction(videoId: string, label: string, notes: string) {
  await requireUser();
  await assertCanSeeVideo(videoId);
  const me = await getCurrentProfile();
  const supabase = await supabaseServer();
  const { count } = await supabase
    .from("video_cuts")
    .select("*", { count: "exact", head: true })
    .eq("video_id", videoId);
  const { data, error } = await supabase
    .from("video_cuts")
    .insert({
      video_id: videoId,
      kind: "hook",
      label: label.trim() || `Hook ${count ?? 1}`,
      notes: notes.trim() || null,
      position: count ?? 1,
      created_by: me?.id ?? null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath(`/videos/${videoId}`);
  return { ok: true, cutId: data.id };
}

export async function updateCutAction(
  cutId: string,
  patch: Partial<Pick<VideoCut, "label" | "notes">>
) {
  await requireUser();
  const supabase = await supabaseServer();
  const { data: cut } = await supabase.from("video_cuts").select("video_id").eq("id", cutId).single();
  const { error } = await supabase.from("video_cuts").update(patch).eq("id", cutId);
  if (error) return { error: error.message };
  if (cut) revalidatePath(`/videos/${cut.video_id}`);
  return { ok: true };
}

export async function deleteCutAction(cutId: string) {
  await requireUser();
  const supabase = await supabaseServer();
  const { data: cut } = await supabase
    .from("video_cuts")
    .select("video_id, kind")
    .eq("id", cutId)
    .single();
  if (cut?.kind === "main") return { error: "The main cut can't be deleted." };
  // Best-effort clean up of Stream assets.
  const { data: versions } = await supabase
    .from("cut_versions")
    .select("stream_uid")
    .eq("cut_id", cutId);
  for (const v of versions ?? []) if (v.stream_uid) await deleteStreamVideo(v.stream_uid);
  const { error } = await supabase.from("video_cuts").delete().eq("id", cutId);
  if (error) return { error: error.message };
  if (cut) revalidatePath(`/videos/${cut.video_id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Versions / uploads (direct-to-Cloudflare)
// ---------------------------------------------------------------------------

export async function createUploadUrlAction(cutId: string) {
  const me = await requireUser();
  const supabase = await supabaseServer();
  const { data: cut } = await supabase
    .from("video_cuts")
    .select("id, video_id, label")
    .eq("id", cutId)
    .single();
  if (!cut) return { error: "Cut not found." };

  try {
    const upload = await createDirectUpload({ name: cut.label, creator: me.id });
    const { count } = await supabase
      .from("cut_versions")
      .select("*", { count: "exact", head: true })
      .eq("cut_id", cutId);
    const version = (count ?? 0) + 1;
    const { data, error } = await supabase
      .from("cut_versions")
      .insert({
        cut_id: cutId,
        version,
        stream_uid: upload.uid,
        status: "uploading",
        uploaded_by: me.id,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };
    return { ok: true, uploadURL: upload.uploadURL, uid: upload.uid, versionId: data.id, version };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * A signed upload URL for the ORIGINAL file of a version. Stream re-encodes
 * what it's given, so the untouched file goes to Storage separately (and on to
 * Drive) — see migration 037.
 */
export async function createOriginalUploadAction(versionId: string, filename: string) {
  await requireUser();
  const supabase = await supabaseServer();
  const { data: v } = await supabase.from("cut_versions").select("id").eq("id", versionId).maybeSingle();
  if (!v) return { error: "Version not found." };
  const ext = filename.split(".").pop()?.toLowerCase() || "mp4";
  const path = `cuts/${versionId}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await supabaseAdmin().storage.from("footage").createSignedUploadUrl(path);
  if (error) return { error: error.message };
  return { ok: true as const, path, signedUrl: data.signedUrl };
}

/** Record where the original landed, and start moving it into Drive. */
export async function registerCutOriginalAction(input: {
  versionId: string;
  path: string;
  name: string;
  bytes: number;
}) {
  await requireUser();
  const supabase = await supabaseServer();
  const { data: v } = await supabase
    .from("cut_versions")
    .select("id, cut_id")
    .eq("id", input.versionId)
    .maybeSingle();
  if (!v) return { error: "Version not found." };
  if (!input.path.startsWith(`cuts/${input.versionId}/`)) return { error: "That file doesn't belong to this version." };
  const { error } = await supabaseAdmin()
    .from("cut_versions")
    .update({ original_path: input.path, original_name: input.name, original_bytes: input.bytes })
    .eq("id", input.versionId);
  if (error) return { error: error.message };
  // after(): a bare floating promise is frozen once the response is sent.
  after(() => mirrorCutOriginalToDrive(input.versionId));
  return { ok: true as const };
}

/** Poll Cloudflare and sync a version's status/thumbnail/duration into the DB. */
export async function syncVersionAction(versionId: string) {
  await requireUser();
  const supabase = await supabaseServer();
  const { data: v } = await supabase
    .from("cut_versions")
    .select("id, cut_id, stream_uid, status")
    .eq("id", versionId)
    .single();
  if (!v?.stream_uid) return { error: "No Stream video." };
  try {
    const state = await getStreamVideo(v.stream_uid);
    await supabase
      .from("cut_versions")
      .update({
        status: state.status,
        duration_seconds: state.durationSeconds,
        thumbnail_url: state.thumbnailUrl,
        playback_url: state.playbackUrl,
      })
      .eq("id", versionId);
    const { data: cut } = await supabase
      .from("video_cuts")
      .select("video_id")
      .eq("id", v.cut_id)
      .single();
    if (cut) revalidatePath(`/videos/${cut.video_id}`);
    return { ok: true, status: state.status };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function revertToVersionAction(cutId: string, version: number) {
  const me = await requireUser();
  const supabase = await supabaseServer();
  // "Revert" = clone the chosen version as a new top version, so history stays intact.
  const { data: src } = await supabase
    .from("cut_versions")
    .select("*")
    .eq("cut_id", cutId)
    .eq("version", version)
    .single();
  if (!src) return { error: "Version not found." };
  const { count } = await supabase
    .from("cut_versions")
    .select("*", { count: "exact", head: true })
    .eq("cut_id", cutId);
  const { error } = await supabase.from("cut_versions").insert({
    cut_id: cutId,
    version: (count ?? 0) + 1,
    stream_uid: src.stream_uid,
    status: src.status,
    duration_seconds: src.duration_seconds,
    thumbnail_url: src.thumbnail_url,
    playback_url: src.playback_url,
    uploaded_by: me.id,
  });
  if (error) return { error: error.message };
  const { data: cut } = await supabase.from("video_cuts").select("video_id").eq("id", cutId).single();
  if (cut) revalidatePath(`/videos/${cut.video_id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Timeline comments (point + range, threaded, resolvable)
// ---------------------------------------------------------------------------

const MEDIA_BUCKET = "comment-media";
/** Long enough to read a thread without re-fetching, short enough to expire. */
const SIGNED_URL_TTL = 60 * 60 * 6;

/**
 * Mint short-lived signed URLs for every voice note and attachment in a batch
 * of comments. RLS has already decided the caller may see these comments, so
 * this is the one place allowed to hand out media links for them.
 */
async function attachSignedMedia(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  comments: CutComment[]
): Promise<CutComment[]> {
  const paths = new Set<string>();
  for (const c of comments) {
    if (c.voice_path) paths.add(c.voice_path);
    for (const a of c.attachments ?? []) paths.add(a.path);
  }
  if (!paths.size) return comments;

  const { data } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls([...paths], SIGNED_URL_TTL);

  const byPath = new Map<string, string>();
  for (const row of data ?? []) {
    // `path` is echoed back on each row; skip any the storage API failed on.
    if (row.path && row.signedUrl) byPath.set(row.path, row.signedUrl);
  }

  return comments.map((c) => ({
    ...c,
    voice_url: c.voice_path ? byPath.get(c.voice_path) : undefined,
    attachments: (c.attachments ?? []).map((a) => ({
      ...a,
      signed_url: byPath.get(a.path),
    })),
  }));
}

export async function listCutComments(cutId: string): Promise<CutComment[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("cut_comments")
    .select(
      "*, author:profiles!cut_comments_author_id_fkey (id, full_name, email, role)," +
        " assignee:profiles!cut_comments_assignee_id_fkey (id, full_name, email, role)"
    )
    .eq("cut_id", cutId)
    .order("created_at");
  // Two joins onto `profiles` confuse PostgREST's generated row type, so the
  // shape is asserted here rather than inferred.
  return attachSignedMedia(supabase, (data as unknown as CutComment[]) ?? []);
}

export async function addCutCommentAction(input: {
  cutId: string;
  videoId: string;
  version: number | null;
  body: string;
  tStart: number | null;
  tEnd: number | null;
  parentId?: string | null;
  visibility?: CommentVisibility;
  assigneeId?: string | null;
  drawing?: Drawing | null;
  voicePath?: string | null;
  voiceDuration?: number | null;
  voicePeaks?: number[] | null;
  attachments?: CommentAttachment[];
}) {
  const me = await requireUser();
  const supabase = await supabaseServer();
  const body = input.body.trim();
  const attachments = (input.attachments ?? []).map((a) => ({
    // Never round-trip a signed URL into the row — they expire.
    path: a.path,
    name: a.name,
    size: a.size,
    type: a.type,
  }));

  const hasContent =
    body.length > 0 || input.voicePath || input.drawing?.strokes?.length || attachments.length;
  if (!hasContent) return { error: "Add a note, a recording, a drawing or a file." };

  const mentions = await resolveMentions(body);
  const { error } = await supabase.from("cut_comments").insert({
    cut_id: input.cutId,
    version: input.version,
    parent_comment_id: input.parentId ?? null,
    author_id: me.id,
    body,
    t_start_seconds: input.tStart,
    t_end_seconds: input.tEnd,
    mentions,
    visibility: input.visibility ?? "internal",
    assignee_id: input.assigneeId ?? null,
    drawing: input.drawing?.strokes?.length ? input.drawing : null,
    voice_path: input.voicePath ?? null,
    voice_duration_seconds: input.voiceDuration ?? null,
    voice_peaks: input.voicePeaks ?? null,
    attachments,
  });
  if (error) return { error: error.message };

  // An assignee is an explicit "this one's yours" — notify them even without
  // an @mention, and don't double-notify if they were also mentioned.
  const notified = new Set<string>();
  if (mentions.length) {
    for (const id of mentions) if (id !== me.id) notified.add(id);
    await notify({
      userIds: [...notified],
      kind: "mention",
      title: `${me.full_name || me.email} mentioned you on a video`,
      body: body.slice(0, 200) || "Left a recording",
      link: `/videos/${input.videoId}`,
      videoId: input.videoId,
    });
  }
  if (input.assigneeId && input.assigneeId !== me.id && !notified.has(input.assigneeId)) {
    await notify({
      userIds: [input.assigneeId],
      kind: "comment",
      title: `${me.full_name || me.email} left you a note`,
      body: body.slice(0, 200) || "Left a recording",
      link: `/videos/${input.videoId}`,
      videoId: input.videoId,
    });
  }

  revalidatePath(`/videos/${input.videoId}`);
  return { ok: true };
}


export async function toggleCommentResolvedAction(commentId: string, videoId: string) {
  const me = await requireUser();
  const supabase = await supabaseServer();
  const { data: c } = await supabase
    .from("cut_comments")
    .select("resolved, author_id")
    .eq("id", commentId)
    .maybeSingle();
  if (!c) return { error: "Comment not found." };

  const nextResolved = !c.resolved;
  const isManager = me.role === "owner" || me.role === "admin";

  if (c.author_id === me.id || isManager) {
    // `cc_update` already allows this: the comment's own author, or a manager.
    const { error } = await supabase
      .from("cut_comments")
      .update({ resolved: nextResolved })
      .eq("id", commentId);
    if (error) return { error: error.message };
  } else {
    // An editor resolving someone *else's* note — almost always the client's,
    // which is the whole point of the button. RLS only trusts the comment's
    // author or a manager, so the one extra case an editor legitimately needs
    // — their own assigned video, or one still open in the Ready to Edit pool
    // — is checked by hand here and written with the admin client, mirroring
    // `can_see_video()`.
    const { data: video } = await supabase
      .from("videos")
      .select("assigned_editor_id, status")
      .eq("id", videoId)
      .maybeSingle();
    const allowed =
      me.role === "editor" &&
      (video?.assigned_editor_id === me.id || video?.status === "ready_to_edit");
    if (!allowed) return { error: "You can't resolve that." };
    const { error } = await supabaseAdmin()
      .from("cut_comments")
      .update({ resolved: nextResolved })
      .eq("id", commentId);
    if (error) return { error: error.message };
  }

  revalidatePath(`/videos/${videoId}`);
  return { ok: true };
}

export async function deleteCutCommentAction(commentId: string, videoId: string) {
  await requireUser();
  const supabase = await supabaseServer();
  const { error } = await supabase.from("cut_comments").delete().eq("id", commentId);
  if (error) return { error: error.message };
  revalidatePath(`/videos/${videoId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Transcripts
// ---------------------------------------------------------------------------

export async function getTranscript(
  cutId: string,
  version: number
): Promise<CutTranscript | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("cut_transcripts")
    .select("*")
    .eq("cut_id", cutId)
    .eq("version", version)
    .maybeSingle();
  return (data as CutTranscript) ?? null;
}

/**
 * Run Whisper over a cut's current version and store the timed cues.
 * No-ops with a clear message when no OpenAI key is configured yet, so the tab
 * degrades to "not transcribed" rather than erroring.
 */
export async function generateTranscriptAction(
  cutId: string,
  version: number,
  videoId: string
) {
  const me = await requireUser();
  const supabase = await supabaseServer();

  const { data: v } = await supabase
    .from("cut_versions")
    .select("playback_url, status")
    .eq("cut_id", cutId)
    .eq("version", version)
    .maybeSingle();
  if (!v?.playback_url) return { error: "This version has no playable file yet." };

  try {
    const result = await transcribeWithTimestamps(v.playback_url);
    if ("error" in result) return { error: result.error };
    const { error } = await supabase.from("cut_transcripts").upsert(
      {
        cut_id: cutId,
        version,
        language: result.language,
        cues: result.cues,
        source: "whisper",
        created_by: me.id,
      },
      { onConflict: "cut_id,version,language" }
    );
    if (error) return { error: error.message };
    revalidatePath(`/videos/${videoId}`);
    return { ok: true, cues: result.cues.length };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Manual paste-in / correction path, so a transcript exists without an API key. */
export async function saveTranscriptAction(
  cutId: string,
  version: number,
  videoId: string,
  cues: TranscriptCue[]
) {
  const me = await requireUser();
  const supabase = await supabaseServer();
  const { error } = await supabase.from("cut_transcripts").upsert(
    {
      cut_id: cutId,
      version,
      language: "en",
      cues,
      source: "manual",
      created_by: me.id,
    },
    { onConflict: "cut_id,version,language" }
  );
  if (error) return { error: error.message };
  revalidatePath(`/videos/${videoId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Post variants — hand every ready hook variant to Drive in one go, so they
// end up somewhere postable (a phone, Meta Business Suite, wherever) without
// downloading each one out of Stream by hand. Doesn't touch Stream itself —
// unlike the Posted archive sweep, these are still in active review.
// ---------------------------------------------------------------------------

export async function postVariantsToDriveAction(videoId: string) {
  await requireRole("owner", "admin");
  const db = supabaseAdmin();

  const { data: video } = await db.from("videos").select("title").eq("id", videoId).maybeSingle();
  if (!video) return { error: "Video not found." };

  const { data: hookCuts } = await db
    .from("video_cuts")
    .select("id, label")
    .eq("video_id", videoId)
    .eq("kind", "hook");
  if (!hookCuts?.length) return { error: "No hook variants on this video yet." };

  let uploaded = 0;
  const links: string[] = [];
  const failed: string[] = [];

  for (const cut of hookCuts) {
    const { data: top } = await db
      .from("cut_versions")
      .select("stream_uid, version, status, original_path, original_drive_url, original_name")
      .eq("cut_id", cut.id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!top?.stream_uid || top.status !== "ready") {
      failed.push(`${cut.label} (not ready)`);
      continue;
    }
    try {
      // Original first (see migration 037); Stream's re-encode only for old versions.
      if (top.original_drive_url) {
        links.push(top.original_drive_url as string);
        uploaded += 1;
        continue;
      }
      const { uploadFromUrl } = await import("@/lib/integrations/drive");
      let src: string | null = null;
      if (top.original_path) {
        const { data: signed } = await db.storage.from("footage").createSignedUrl(top.original_path as string, 900);
        src = signed?.signedUrl ?? null;
      }
      const dl = src ?? (await getDownloadUrl(top.stream_uid));
      if (!dl) {
        failed.push(cut.label);
        continue;
      }
      const link = await uploadFromUrl(dl, `${video.title} — ${cut.label} v${top.version}.mp4`);
      links.push(link);
      uploaded += 1;
    } catch (e) {
      if (e instanceof Error && e.message.includes("not configured")) {
        return { error: "Google Drive isn't connected — add it in Settings → Integrations." };
      }
      failed.push(cut.label);
    }
  }

  if (uploaded === 0) return { error: "Couldn't send any variants — check they're finished processing." };

  const { getWorkspaceSettings } = await import("@/lib/workspace");
  const settings = await getWorkspaceSettings();
  const folderLink = settings.drive_folder_id
    ? `https://drive.google.com/drive/folders/${settings.drive_folder_id}`
    : null;

  // Close the loop the same way a posted video already does — a Telegram
  // ping with the link, so this can be picked up from a phone without
  // opening the dashboard at all.
  const { notifyTelegram } = await import("@/lib/notify");
  await notifyTelegram(
    `🎬 ${uploaded} variant${uploaded === 1 ? "" : "s"} of “${video.title}” sent to Drive.` +
      (folderLink ? `\n${folderLink}` : "")
  );

  return {
    ok: true as const,
    uploaded,
    total: hookCuts.length,
    failed,
    folderLink,
  };
}

// ---------------------------------------------------------------------------
// Cloudflare Stream webhook target (called by src/app/api/stream/webhook)
// ---------------------------------------------------------------------------

export async function ingestStreamWebhook(uid: string) {
  const db = supabaseAdmin();
  const { data: v } = await db.from("cut_versions").select("id").eq("stream_uid", uid).maybeSingle();
  if (!v) return;
  const state = await getStreamVideo(uid);
  await db
    .from("cut_versions")
    .update({
      status: state.status,
      duration_seconds: state.durationSeconds,
      thumbnail_url: state.thumbnailUrl,
      playback_url: state.playbackUrl,
    })
    .eq("id", v.id);
}
