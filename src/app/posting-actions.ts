"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { getDownloadUrl } from "@/lib/integrations/stream";
import { getWorkspaceSettings, integrationStatus } from "@/lib/workspace";
import { markVideoPosted } from "@/lib/archive";
import { mintPhoneToken } from "@/lib/phone-link";
import { ORIGINAL_COLUMNS, hasOriginal } from "@/lib/cut-files";
import { runPublishJob } from "@/lib/publish-runner";
import { linkMainFeedAnalytics } from "@/lib/analytics-link";
import { isOnMainFeed, type VariantChoice } from "@/lib/variant-state";
import { notify } from "@/lib/notify";
import { releaseFromVa } from "@/lib/va-handoff";
import type { PublishStatus, TrialPost, TrialStatus } from "@/lib/types";

// ---------------------------------------------------------------------------
// The VA's posting surface.
//
// A VA has NO row access under RLS — deliberately. Their whole job is "post
// what's queued, paste the link back, type the numbers in", and this file is
// that job and nothing else: service-role reads that hand-pick fields, the
// same pattern the MCP tools and guest links already use. Titles and captions
// reach them; scripts, budgets, analytics and settings never do. Every write
// is limited to the trial columns a poster legitimately owns.
//
// Managers pass the same gates so they can see exactly what the VA sees.
// ---------------------------------------------------------------------------

export interface PostingTrialItem {
  id: string;
  videoId: string;
  videoTitle: string;
  label: string;
  caption: string | null;
  /** Instagram trial reel, or straight to the main feed. */
  postAs: "trial" | "main";
  /** Live on the main feed (posted there, or promoted from a trial). */
  onMainFeed: boolean;
  /** Set once the variant has been handed to Instagram's scheduler. */
  scheduled: boolean;
  /** Instructions for the whole video. */
  notes: string | null;
  /** Instructions for this variant in particular. */
  variantNotes: string | null;
  /** Signed link to the cover image, when one was uploaded. */
  coverUrl: string | null;
  /** A carousel has no video file — these are its slide images, in order. */
  images: string[] | null;
  /** Length of the variant's latest cut, to bound the cover-frame picker. */
  durationSeconds: number | null;
  status: TrialStatus;
  scheduled_for: string | null;
  posted_at: string | null;
  permalink: string | null;
  winner: boolean;
  hasMetrics: boolean;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

export interface PostingJobItem {
  id: string;
  videoTitle: string;
  caption: string | null;
  scheduled_for: string | null;
  status: PublishStatus;
  channels: string[];
  error: string | null;
}

/**
 * Everything on the posting desk: trials to post by hand (planned), live
 * trials awaiting their numbers (posted), and — for context — the automatic
 * publish queue, so the VA never double-posts something the API will handle.
 */
export async function listPostingWork(): Promise<{
  trials: PostingTrialItem[];
  jobs: PostingJobItem[];
  instagramConnected: boolean;
}> {
  await requireRole("va", "owner", "admin");
  const db = supabaseAdmin();

  const settings = await getWorkspaceSettings();
  // The VA's desk is defined by the video's stage: everything on a video that is
  // "With the VA", plus variants already posted from earlier hand-offs (the record).
  const { data: withVa } = await db.from("videos").select("id").eq("status", "with_va");
  const withVaIds = (withVa ?? []).map((v) => v.id as string);
  const select = "*, video:videos (title, va_notes, cover_path, post_caption)";
  const [{ data: current }, { data: history }, { data: jobs }] = await Promise.all([
    withVaIds.length
      ? db.from("trial_posts").select(select).in("video_id", withVaIds).neq("status", "archived")
      : Promise.resolve({ data: [] as never[] }),
    db.from("trial_posts").select(select).in("status", ["posted", "promoted"]).not("sent_to_va_at", "is", null),
    db
      .from("publish_jobs")
      .select("id, caption, scheduled_for, status, channels, error, video:videos (title)")
      .in("status", ["scheduled", "publishing", "failed"])
      .order("scheduled_for", { ascending: true, nullsFirst: false })
      .limit(30),
  ]);
  const seen = new Set<string>();
  const trials = [...(current ?? []), ...(history ?? [])]
    .filter((t) => (seen.has(t.id as string) ? false : (seen.add(t.id as string), true)))
    .sort((x, y) => String(x.scheduled_for ?? "9999").localeCompare(String(y.scheduled_for ?? "9999")));

  return {
    instagramConnected: integrationStatus(settings).instagram,
    trials: await Promise.all(((trials as (TrialPost & {
      video: { title: string; va_notes: string | null; cover_path: string | null; post_caption: string | null } | null;
    })[]) ?? []).map(async (t) => {
      let images: string[] | null = null;
      if (t.cut_id === null) {
        const { data: slides } = await db
          .from("carousel_images")
          .select("storage_path")
          .eq("video_id", t.video_id)
          .not("storage_path", "is", null)
          .order("position");
        images = (
          await Promise.all(
            (slides ?? []).map(async (sl) => {
              const { data: u } = await db.storage
                .from("carousels")
                .createSignedUrl(sl.storage_path as string, 3600, { download: true });
              return u?.signedUrl ?? null;
            })
          )
        ).filter((u): u is string => Boolean(u));
      }
      let durationSeconds: number | null = null;
      if (t.cut_id) {
        const { data: ver } = await db
          .from("cut_versions")
          .select("duration_seconds")
          .eq("cut_id", t.cut_id)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();
        durationSeconds = (ver?.duration_seconds as number | null) ?? null;
      }
      let coverUrl: string | null = null;
      const coverPath = t.cover_path ?? t.video?.cover_path ?? null;
      if (coverPath) {
        const { data: signed } = await db.storage.from("footage").createSignedUrl(coverPath, 3600);
        coverUrl = signed?.signedUrl ?? null;
      }
      return {
      id: t.id,
      videoId: t.video_id,
      videoTitle: t.video?.title ?? "Untitled",
      label: t.label,
      // The variant's own caption, else the video's shared one from the Post tab.
      caption: t.caption?.trim() ? t.caption : (t.video?.post_caption?.trim() ? t.video.post_caption : null),
      // Everything is posted as a trial unless someone chose the main feed.
      postAs: t.post_as === "main" ? "main" : "trial",
      onMainFeed: isOnMainFeed(t),
      scheduled: t.status === "promoted" && !t.posted_at,
      // Video-wide instructions, and this variant's own — both live, so edits reach the desk at once.
      notes: t.video?.va_notes ?? null,
      variantNotes: t.notes ?? null,
      coverUrl,
      images,
      durationSeconds,
      status: t.status,
      scheduled_for: t.scheduled_for,
      posted_at: t.posted_at,
      permalink: t.permalink,
      winner: t.winner,
      hasMetrics: t.views !== null || t.likes !== null,
      views: t.views,
      likes: t.likes,
      comments: t.comments,
      shares: t.shares,
      saves: t.saves,
      };
    })),
    jobs: (
      (jobs as unknown as {
        id: string;
        caption: string | null;
        scheduled_for: string | null;
        status: PublishStatus;
        channels: string[];
        error: string | null;
        video: { title: string } | null;
      }[]) ?? []
    ).map((j) => ({
      id: j.id,
      videoTitle: j.video?.title ?? "Untitled",
      caption: j.caption,
      scheduled_for: j.scheduled_for,
      status: j.status,
      channels: j.channels ?? ["instagram"],
      error: j.error,
    })),
  };
}

/**
 * The posting kit for one trial: a fresh download link for the exact cut to
 * upload, plus the caption to paste. Minted at click time — download URLs are
 * short-lived by design.
 */
export async function trialPostingKitAction(trialId: string): Promise<
  | { ok: true; downloadUrl: string | null; caption: string | null; label: string; original: boolean }
  | { error: string }
> {
  await requireRole("va", "owner", "admin");
  const db = supabaseAdmin();

  const { data: trial } = await db
    .from("trial_posts")
    .select("cut_id, caption, label, video:videos (post_caption)")
    .eq("id", trialId)
    .maybeSingle();
  if (!trial) return { error: "Trial not found." };

  let downloadUrl: string | null = null;
  let original = false;
  if (trial.cut_id) {
    // The ORIGINAL upload first — Stream's own download is a re-encode, much
    // smaller and softer than what was uploaded. Stream is only the fallback
    // for versions uploaded before originals were kept.
    const { data: top } = await db
      .from("cut_versions")
      .select(`id, stream_uid, drive_file_url, ${ORIGINAL_COLUMNS}`)
      .eq("cut_id", trial.cut_id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (top && hasOriginal(top as never)) {
      downloadUrl = `/api/cut-original/${top.id}`;
      original = true;
    }
    if (!downloadUrl && top?.stream_uid) {
      try {
        downloadUrl = await getDownloadUrl(top.stream_uid);
      } catch {
        downloadUrl = null;
      }
    }
  }
  const shared = (trial.video as unknown as { post_caption: string | null } | null)?.post_caption;
  const caption = (trial.caption as string | null)?.trim() ? (trial.caption as string) : shared?.trim() ? shared : null;
  return { ok: true, downloadUrl, caption, label: trial.label, original };
}

/**
 * When every variant that was sent to the VA is posted (or scheduled), the
 * video itself is posted: stamped, dated so it shows on the calendar, and
 * queued for the Drive archive — exactly what the client's own "Mark as
 * posted" does.
 */
async function finishVideoIfDone(videoId: string) {
  const db = supabaseAdmin();
  const { data: open } = await db
    .from("trial_posts")
    .select("id")
    .eq("video_id", videoId)
    .eq("status", "planned")
    .limit(1);
  if (open?.length) return false;
  await markVideoPosted(videoId);
  revalidatePath("/calendar");
  revalidatePath("/archive");
  revalidatePath("/board");
  revalidatePath(`/videos/${videoId}`);
  return true;
}

/** The VA closes the loop: it's live. The link is optional but welcome. */
export async function vaMarkTrialPostedAction(trialId: string, permalink?: string) {
  const me = await requireRole("va", "owner", "admin");
  const db = supabaseAdmin();
  const { data: t, error } = await db
    .from("trial_posts")
    .update({
      status: "posted",
      posted_at: new Date().toISOString(),
      posted_by: me.id,
      permalink: permalink?.trim() || null,
    })
    .eq("id", trialId)
    .eq("status", "planned")
    .select("video_id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!t) return { error: "That one was already marked as posted." };
  const finished = await finishVideoIfDone(t.video_id as string);
  if (permalink?.trim()) {
    const { data: row } = await db.from("trial_posts").select("post_as").eq("id", trialId).maybeSingle();
    if (row?.post_as === "main") await linkMainFeedAnalytics(t.video_id as string, permalink);
  }
  revalidatePath("/posting");
  return { ok: true as const, finished };
}

/**
 * Post straight to Instagram from the posting desk — now, or scheduled. Only
 * for a main-feed video (Meta's API can't post a trial reel or a carousel), and
 * only once Instagram has been connected in Settings → Integrations, which is
 * a one-off for the whole workspace rather than something each person does.
 * The caption on the variant goes in as the caption.
 */
export async function vaPublishAction(
  trialId: string,
  opts: {
    /** ISO instant to go out at; null/omitted = post now. */
    whenISO?: string | null;
    /** The caption as edited in the form — saved back onto the variant. */
    caption?: string | null;
    coverOffsetMs?: number;
    shareToFeed?: boolean;
  } = {}
) {
  const whenISO = opts.whenISO ?? null;
  const me = await requireRole("va", "owner", "admin");
  const db = supabaseAdmin();
  const settings = await getWorkspaceSettings();
  if (!integrationStatus(settings).instagram) {
    return { error: "Instagram isn't connected yet. Connect it in Settings → Integrations, or post by hand and mark it posted." };
  }
  const { data: t } = await db.from("trial_posts").select("*").eq("id", trialId).maybeSingle();
  if (!t || t.status !== "planned") return { error: "That one isn't waiting to be posted." };
  if (t.post_as !== "main") return { error: "Trial reels can't be posted through Instagram's API — post it from the app." };

  const caption = opts.caption !== undefined ? opts.caption?.trim() || null : (t.caption as string | null);
  if (opts.caption !== undefined) await db.from("trial_posts").update({ caption }).eq("id", trialId);

  const when = whenISO ? new Date(whenISO) : null;
  if (when && Number.isNaN(when.getTime())) return { error: "That date didn't parse." };
  const scheduled = when && when.getTime() > Date.now() + 60_000;

  const { data: job, error } = await db
    .from("publish_jobs")
    .insert({
      video_id: t.video_id,
      cut_id: t.cut_id,
      caption,
      channels: ["instagram"],
      scheduled_for: (scheduled ? when : new Date())!.toISOString(),
      status: "scheduled",
      cover_offset_ms: Math.max(0, Math.round(opts.coverOffsetMs ?? 0)),
      share_to_feed: opts.shareToFeed ?? true,
      created_by: me.id,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  const stamp = { promoted_job_id: job.id, posted_by: me.id };
  if (scheduled) {
    // Goes out by itself at that time; until then it's on the calendar for that day.
    await db.from("trial_posts").update({ ...stamp, status: "promoted" }).eq("id", trialId);
    await db.from("videos").update({ post_date: when!.toISOString().slice(0, 10) }).eq("id", t.video_id);
    revalidatePath("/posting");
    revalidatePath("/calendar");
    return { ok: true as const, scheduled: true };
  }

  const res = await runPublishJob(job.id);
  if (!res.ok) return { error: `Instagram didn't take it: ${res.error}` };
  await db
    .from("trial_posts")
    .update({ ...stamp, status: "posted", posted_at: new Date().toISOString() })
    .eq("id", trialId);
  await finishVideoIfDone(t.video_id as string);
  revalidatePath("/posting");
  return { ok: true as const, scheduled: false };
}

/** Trial numbers, typed in from the IG app's insights screen. */
export async function vaSaveTrialMetricsAction(
  trialId: string,
  m: { views?: number | null; likes?: number | null; comments?: number | null; shares?: number | null; saves?: number | null }
) {
  const me = await requireRole("va", "owner", "admin");
  const db = supabaseAdmin();
  const num = (v: number | null | undefined) =>
    v === null || v === undefined || Number.isNaN(v) ? null : Math.max(0, Math.round(v));
  const { error } = await db
    .from("trial_posts")
    .update({
      views: num(m.views),
      likes: num(m.likes),
      comments: num(m.comments),
      shares: num(m.shares),
      saves: num(m.saves),
      metrics_updated_at: new Date().toISOString(),
      metrics_updated_by: me.id,
    })
    .eq("id", trialId);
  if (error) return { error: error.message };
  revalidatePath("/posting");
  revalidatePath("/analytics");
  return { ok: true };
}

/**
 * Take a scheduled post back off the schedule. The job is cancelled and the
 * variant goes back to "to post", so it can be rescheduled or posted by hand.
 */
export async function vaCancelScheduledAction(jobId: string) {
  await requireRole("va", "owner", "admin");
  const db = supabaseAdmin();
  const { data: job } = await db.from("publish_jobs").select("status").eq("id", jobId).maybeSingle();
  if (!job || job.status !== "scheduled") return { error: "That one isn't scheduled any more." };
  const { error } = await db.from("publish_jobs").update({ status: "cancelled" }).eq("id", jobId);
  if (error) return { error: error.message };
  await db
    .from("trial_posts")
    .update({ status: "planned", promoted_job_id: null })
    .eq("promoted_job_id", jobId)
    .eq("status", "promoted");
  revalidatePath("/posting");
  revalidatePath("/publishing");
  revalidatePath("/calendar");
  return { ok: true as const };
}

/** The VA (or a manager) flips a variant between trial reel and main feed. */
export async function vaSetPostAsAction(trialId: string, postAs: "trial" | "main") {
  await requireRole("va", "owner", "admin");
  if (postAs !== "trial" && postAs !== "main") return { error: "Pick trial or main feed." };
  const { error } = await supabaseAdmin()
    .from("trial_posts")
    .update({ post_as: postAs })
    .eq("id", trialId)
    .eq("status", "planned");
  if (error) return { error: error.message };
  revalidatePath("/posting");
  return { ok: true };
}

/**
 * Change where a variant is in its life — the dropdown on every variant, on
 * the posting desk, in the posted list and in the client's own Post tab.
 *
 *   trial        it's (to be) posted as a trial reel
 *   main         it's to be posted to the main feed
 *   posted_main  it has been posted to the main feed — the trial that won, or
 *                one that went straight there. Marks it live and, when there's
 *                a link, connects the post to its analytics.
 *   to_post      undo: back to waiting to be posted
 */
export async function vaSetVariantStateAction(
  trialId: string,
  choice: VariantChoice | "to_post",
  permalink?: string | null
) {
  const me = await requireRole("va", "owner", "admin");
  const db = supabaseAdmin();
  const { data: t } = await db.from("trial_posts").select("*").eq("id", trialId).maybeSingle();
  if (!t) return { error: "Variant not found." };
  const now = new Date().toISOString();
  const link = permalink === undefined ? (t.permalink as string | null) : permalink?.trim() || null;
  let patch: Record<string, unknown>;

  if (choice === "trial") {
    patch = { post_as: "trial", ...(t.status === "promoted" ? { status: "posted", posted_at: t.posted_at ?? now } : {}) };
  } else if (choice === "main") {
    if (t.status !== "planned") return { error: "It's already posted — pick “Posted to main feed” to record where it went." };
    patch = { post_as: "main" };
  } else if (choice === "posted_main") {
    const wasTrial = t.status === "posted" && t.post_as !== "main";
    patch = {
      post_as: "main",
      status: t.status === "promoted" ? "promoted" : "posted",
      posted_at: t.posted_at ?? now,
      posted_by: t.posted_by ?? me.id,
      permalink: link,
      // The trial that got promoted is the winner by definition.
      ...(wasTrial || t.status === "promoted" ? { winner: true } : {}),
    };
  } else if (choice === "to_post") {
    patch = { status: "planned", posted_at: null, promoted_job_id: null };
  } else {
    return { error: "Unknown option." };
  }

  const { error } = await db.from("trial_posts").update(patch).eq("id", trialId);
  if (error) return { error: error.message };

  let linked = false;
  if (choice === "posted_main") {
    linked = await linkMainFeedAnalytics(t.video_id as string, link);
    if (t.status === "planned") await finishVideoIfDone(t.video_id as string);
  }
  revalidatePath("/posting");
  revalidatePath("/archive");
  revalidatePath(`/videos/${t.video_id}`);
  return { ok: true as const, linked };
}

/** Save (or correct) the link to a posted variant — and, on the main feed, connect it to its analytics. */
export async function vaSaveLinkAction(trialId: string, permalink: string) {
  await requireRole("va", "owner", "admin");
  const db = supabaseAdmin();
  const { data: t } = await db.from("trial_posts").select("video_id, status, post_as").eq("id", trialId).maybeSingle();
  if (!t) return { error: "Variant not found." };
  const link = permalink.trim() || null;
  const { error } = await db.from("trial_posts").update({ permalink: link }).eq("id", trialId);
  if (error) return { error: error.message };
  const linked = isOnMainFeed(t as never) ? await linkMainFeedAnalytics(t.video_id as string, link) : false;
  revalidatePath("/posting");
  revalidatePath(`/videos/${t.video_id}`);
  return { ok: true as const, linked };
}

/**
 * The VA sends a video back to the client's side because something needs
 * changing before it can go out. The video goes from With the VA back to Ready
 * to Post on the client's board, the variants leave the posting desk with their
 * captions intact, and anything scheduled for it is taken off the schedule. The
 * reason is posted in the video's chat and the owner/admins are told.
 */
export async function vaSendBackAction(videoId: string, reason: string) {
  const me = await requireRole("va", "owner", "admin");
  const note = reason.trim();
  if (!note) return { error: "Say what needs changing, so they know what to look at." };
  const db = supabaseAdmin();
  const { data: video } = await db.from("videos").select("title, status").eq("id", videoId).maybeSingle();
  if (!video) return { error: "Video not found." };
  if (video.status !== "with_va") return { error: "It isn't with the VA any more." };

  // Off the VA's desk, off the schedule, back in Ready to Post.
  await releaseFromVa(videoId);
  const { error } = await db.from("videos").update({ status: "ready_to_post" }).eq("id", videoId);
  if (error) return { error: error.message };

  const who = (me as { full_name?: string | null; email?: string }).full_name || (me as { email?: string }).email || "The VA";
  await db.from("video_messages").insert({
    video_id: videoId,
    author_id: me.id,
    body: `Sent back from the posting desk: ${note}`,
    mentions: [],
  });
  await db.from("video_activity").insert({
    video_id: videoId,
    actor_id: me.id,
    kind: "status",
    summary: `Sent back from the VA → Ready to Post: ${note}`,
  });
  const { data: managers } = await db.from("profiles").select("id").in("role", ["owner", "admin"]).eq("active", true);
  await notify({
    userIds: (managers ?? []).map((m) => m.id as string),
    kind: "revision",
    title: `${who} sent “${video.title}” back`,
    body: note,
    link: `/videos/${videoId}`,
    videoId,
  });

  revalidatePath("/posting");
  revalidatePath("/board");
  revalidatePath(`/videos/${videoId}`);
  return { ok: true as const };
}

/**
 * A short-lived token for the "send to phone" QR code. The client builds the
 * URL from it (`/api/variant/<token>`) so the code always points at whichever
 * domain the dashboard is being used from.
 */
export async function variantPhoneTokenAction(trialId: string): Promise<{ token: string }> {
  await requireRole("va", "owner", "admin");
  return { token: mintPhoneToken(trialId) };
}
