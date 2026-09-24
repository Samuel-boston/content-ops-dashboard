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
import { effectiveCaption } from "@/lib/caption";
import { isOnMainFeed, variantState, type VariantState } from "@/lib/variant-state";
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
  /** The video's own stage on the client's board. */
  videoStatus: string;
  label: string;
  caption: string | null;
  /** The one status every screen shows: to post as trial … posted on feed. */
  state: VariantState;
  /** Instagram trial reel, or straight to the main feed. */
  postAs: "trial" | "main";
  /** Instructions for the whole video. */
  notes: string | null;
  /** Instructions for this variant in particular. */
  variantNotes: string | null;
  /** Signed link to the variant's cover (else the video's), when one was uploaded. */
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
  /** The publish job this variant is waiting on, when it's scheduled for the feed. */
  jobId: string | null;
  jobAt: string | null;
}

export interface PostingJobItem {
  id: string;
  videoId: string;
  videoTitle: string;
  caption: string | null;
  scheduled_for: string | null;
  status: PublishStatus;
  channels: string[];
  error: string | null;
}

/** Instagram's own numbers for a video's main-feed post (linked automatically). */
export interface PostingFeedMetrics {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  reach: number | null;
  permalink: string | null;
}

type VideoJoin = { title: string; status: string; va_notes: string | null; cover_path: string | null; post_caption: string | null } | null;
type DB = ReturnType<typeof supabaseAdmin>;

/** Turn trial rows (with their video joined) into what the screens show. */
async function buildItems(db: DB, rows: (TrialPost & { video: VideoJoin })[], jobs: { id: string; scheduled_for: string | null }[]) {
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  // "Same as variant 1": the first variant of each video (by creation order) is the base.
  const firstOf = new Map<string, TrialPost>();
  for (const t of [...rows].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    if (!firstOf.has(t.video_id)) firstOf.set(t.video_id, t);
  }
  return Promise.all(
    rows.map(async (t): Promise<PostingTrialItem> => {
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
      const job = t.promoted_job_id ? jobById.get(t.promoted_job_id) : undefined;
      return {
        id: t.id,
        videoId: t.video_id,
        videoTitle: t.video?.title ?? "Untitled",
        videoStatus: t.video?.status ?? "",
        label: t.label,
        // The variant's own caption, else variant 1's, else the video's shared one from the Post tab.
        caption: t.caption?.trim()
          ? t.caption
          : firstOf.get(t.video_id)?.id !== t.id && firstOf.get(t.video_id)?.caption?.trim()
            ? (firstOf.get(t.video_id)!.caption as string)
            : t.video?.post_caption?.trim()
              ? t.video.post_caption
              : null,
        state: variantState(t),
        postAs: t.post_as === "main" ? "main" : "trial",
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
        jobId: t.promoted_job_id ?? null,
        jobAt: job?.scheduled_for ?? null,
      };
    })
  );
}

async function feedMetricsFor(db: DB, videoIds: string[]): Promise<Record<string, PostingFeedMetrics>> {
  const out: Record<string, PostingFeedMetrics> = {};
  if (!videoIds.length) return out;
  const { data } = await db
    .from("video_metrics")
    .select("video_id, views, likes, comments, shares, saves, reach, permalink")
    .in("video_id", videoIds);
  for (const m of (data ?? []) as (PostingFeedMetrics & { video_id: string })[]) {
    out[m.video_id] = { views: m.views, likes: m.likes, comments: m.comments, shares: m.shares, saves: m.saves, reach: m.reach, permalink: m.permalink };
  }
  return out;
}

async function jobsFor(db: DB, videoIds: string[] | null): Promise<PostingJobItem[]> {
  let q = db
    .from("publish_jobs")
    .select("id, video_id, caption, scheduled_for, status, channels, error, video:videos (title)")
    .in("status", ["scheduled", "publishing", "failed"])
    .order("scheduled_for", { ascending: true, nullsFirst: false })
    .limit(80);
  if (videoIds) q = q.in("video_id", videoIds);
  const { data } = await q;
  return ((data as unknown as {
    id: string; video_id: string; caption: string | null; scheduled_for: string | null;
    status: PublishStatus; channels: string[]; error: string | null; video: { title: string } | null;
  }[]) ?? []).map((j) => ({
    id: j.id,
    videoId: j.video_id,
    videoTitle: j.video?.title ?? "Untitled",
    caption: j.caption,
    scheduled_for: j.scheduled_for,
    status: j.status,
    channels: j.channels ?? ["instagram"],
    error: j.error,
  }));
}

const TRIAL_SELECT = "*, video:videos (title, status, va_notes, cover_path, post_caption)";

/**
 * The posting board: every video that is with the VA, with all of its variants
 * together. Nothing else — a video that's been posted is in the archive, and one
 * that went back to the client isn't here at all.
 */
export async function listPostingWork(): Promise<{
  trials: PostingTrialItem[];
  jobs: PostingJobItem[];
  feedMetrics: Record<string, PostingFeedMetrics>;
  instagramConnected: boolean;
  publerConnected: boolean;
}> {
  await requireRole("va", "owner", "admin");
  const db = supabaseAdmin();
  const [settings, { data: withVa }] = await Promise.all([
    getWorkspaceSettings(),
    db.from("videos").select("id").eq("status", "with_va"),
  ]);
  const ids = (withVa ?? []).map((v) => v.id as string);
  const [{ data: rows }, jobs] = await Promise.all([
    ids.length
      ? db.from("trial_posts").select(TRIAL_SELECT).in("video_id", ids).neq("status", "archived").order("created_at")
      : Promise.resolve({ data: [] as never[] }),
    jobsFor(db, ids),
  ]);
  return {
    // "Can post straight from here": Publer or the Instagram Graph API.
    instagramConnected: integrationStatus(settings).instagram || integrationStatus(settings).publer,
    publerConnected: integrationStatus(settings).publer,
    feedMetrics: {},
    trials: await buildItems(db, (rows ?? []) as unknown as (TrialPost & { video: VideoJoin })[], jobs),
    jobs,
  };
}

/** One video, whole — for opening it from the archive. */
export async function getPostingVideoAction(videoId: string): Promise<{
  trials: PostingTrialItem[];
  jobs: PostingJobItem[];
  feedMetrics: Record<string, PostingFeedMetrics>;
  instagramConnected: boolean;
  publerConnected: boolean;
}> {
  await requireRole("va", "owner", "admin");
  const db = supabaseAdmin();
  const settings = await getWorkspaceSettings();
  const { data: rows } = await db
    .from("trial_posts")
    .select(TRIAL_SELECT)
    .eq("video_id", videoId)
    .neq("status", "archived")
    .order("created_at");
  const jobs = await jobsFor(db, [videoId]);
  return {
    // "Can post straight from here": Publer or the Instagram Graph API.
    instagramConnected: integrationStatus(settings).instagram || integrationStatus(settings).publer,
    publerConnected: integrationStatus(settings).publer,
    feedMetrics: await feedMetricsFor(db, [videoId]),
    trials: await buildItems(db, (rows ?? []) as unknown as (TrialPost & { video: VideoJoin })[], jobs),
    jobs,
  };
}

export interface PostedVideoRow {
  videoId: string;
  title: string;
  postedAt: string | null;
  variants: number;
  trialsLive: number;
  onFeed: number;
  best: { label: string; views: number } | null;
}

/** Every video that went through the VA's desk and is now posted — the archive. */
export async function listPostedVideos(): Promise<PostedVideoRow[]> {
  await requireRole("va", "owner", "admin");
  const db = supabaseAdmin();
  const { data: videos } = await db
    .from("videos")
    .select("id, title, posted_at")
    .eq("status", "posted")
    .order("posted_at", { ascending: false, nullsFirst: false })
    .limit(300);
  const ids = (videos ?? []).map((v) => v.id as string);
  if (!ids.length) return [];
  const { data: trials } = await db
    .from("trial_posts")
    .select("video_id, label, status, post_as, posted_at, views, sent_to_va_at")
    .in("video_id", ids)
    .neq("status", "archived");
  const by = new Map<string, NonNullable<typeof trials>>();
  for (const t of trials ?? []) by.set(t.video_id as string, [...(by.get(t.video_id as string) ?? []), t]);
  return (videos ?? [])
    .filter((v) => (by.get(v.id as string) ?? []).some((t) => t.sent_to_va_at))
    .map((v) => {
      const list = by.get(v.id as string) ?? [];
      const states = list.map((t) => variantState(t as never));
      const live = list
        .filter((t) => variantState(t as never) === "trial_posted" && t.views !== null)
        .sort((a, b) => (b.views as number) - (a.views as number))[0];
      return {
        videoId: v.id as string,
        title: v.title as string,
        postedAt: (v.posted_at as string | null) ?? null,
        variants: list.length,
        trialsLive: states.filter((x) => x === "trial_posted").length,
        onFeed: states.filter((x) => x === "feed_posted").length,
        best: live ? { label: live.label as string, views: live.views as number } : null,
      };
    });
}

/**
 * The VA is done with a video: it moves to Posted and into the archive — the
 * same as the client's own "Mark as posted". Any variant still marked "to post"
 * is counted as posted (as whatever it was set to be); anything already handed
 * to Instagram's scheduler stays scheduled.
 */
export async function vaMarkVideoPostedAction(videoId: string) {
  const me = await requireRole("va", "owner", "admin");
  const db = supabaseAdmin();
  const { data: video } = await db.from("videos").select("status").eq("id", videoId).maybeSingle();
  if (!video) return { error: "Video not found." };
  if (video.status === "posted") return { ok: true as const };
  if (video.status !== "with_va") return { error: "That video isn't with the VA." };
  const now = new Date().toISOString();
  await db
    .from("trial_posts")
    .update({ status: "posted", posted_at: now, posted_by: me.id })
    .eq("video_id", videoId)
    .eq("status", "planned");
  await markVideoPosted(videoId);
  revalidatePath("/posting");
  revalidatePath("/archive");
  revalidatePath("/board");
  revalidatePath("/calendar");
  revalidatePath(`/videos/${videoId}`);
  return { ok: true as const };
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
    .select("cut_id, caption, label, video_id")
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
  const caption = await effectiveCaption(db, { id: trialId, video_id: trial.video_id as string, caption: trial.caption as string | null });
  return { ok: true, downloadUrl, caption, label: trial.label, original };
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
    /** Post it as an Instagram trial reel (Publer only, and only "now"). */
    asTrial?: boolean;
  } = {}
) {
  const whenISO = opts.asTrial ? null : (opts.whenISO ?? null);
  const me = await requireRole("va", "owner", "admin");
  const db = supabaseAdmin();
  const settings = await getWorkspaceSettings();
  const connected = integrationStatus(settings);
  if (opts.asTrial ? !connected.publer : !(connected.instagram || connected.publer)) {
    return {
      error: opts.asTrial
        ? "Trial reels are posted through Publer, which isn't connected yet. Connect it in Settings → Integrations, or post it by hand and tick Posted."
        : "Nothing is connected to post with yet. Connect Publer or Instagram in Settings → Integrations, or post by hand and mark it posted.",
    };
  }
  const { data: t } = await db.from("trial_posts").select("*").eq("id", trialId).maybeSingle();
  const st = t ? variantState(t) : null;
  // Waiting to be posted, or a live trial that did well and is being posted to the feed.
  if (!t || (st !== "to_trial" && st !== "to_feed" && st !== "trial_posted")) {
    return { error: "That one isn't waiting to be posted." };
  }
  if (opts.asTrial && st !== "to_trial") return { error: "Only a variant marked as a trial reel can be posted as one." };
  if (!t.cut_id && !t.post_as) return { error: "Nothing to post." };

  const caption =
    opts.caption !== undefined
      ? opts.caption?.trim() || null
      : await effectiveCaption(db, { id: trialId, video_id: t.video_id as string, caption: t.caption as string | null });
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
      as_trial: Boolean(opts.asTrial),
      created_by: me.id,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  if (opts.asTrial) {
    const sent = await runPublishJob(job.id);
    if (!sent.ok) return { error: `It didn't go through: ${sent.error}` };
    await db
      .from("trial_posts")
      .update({ status: "posted", post_as: "trial", posted_by: me.id, posted_at: new Date().toISOString() })
      .eq("id", trialId);
    revalidatePath("/posting");
    revalidatePath("/calendar");
    return { ok: true as const, scheduled: false };
  }

  const stamp = { promoted_job_id: job.id, posted_by: me.id, post_as: "main" };
  if (scheduled) {
    // Goes out by itself at that time; until then it's on the calendar for that day.
    // (posted_at is cleared so "scheduled" reads as scheduled; the runner sets it when it goes live.)
    await db.from("trial_posts").update({ ...stamp, status: "promoted", posted_at: null }).eq("id", trialId);
    await db.from("videos").update({ post_date: when!.toISOString().slice(0, 10) }).eq("id", t.video_id);
    revalidatePath("/posting");
    revalidatePath("/calendar");
    return { ok: true as const, scheduled: true };
  }

  const res = await runPublishJob(job.id);
  if (!res.ok) return { error: `It didn't go through: ${res.error}` };
  await db
    .from("trial_posts")
    .update({ ...stamp, status: "posted", posted_at: new Date().toISOString(), ...(st === "trial_posted" ? { winner: true } : {}) })
    .eq("id", trialId);
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
 * Set a variant's status — the one control that does it everywhere (the VA's
 * board, the client's Post tab). See lib/variant-state.ts for what each means.
 * Any state can move to any other, so a mistake is never stuck: marking
 * something "posted" that wasn't is undone by picking "To post" again.
 *
 * Posting to the feed records the link and connects it to Instagram's numbers;
 * a variant that goes from live trial to the feed is the winner by definition
 * (its trial numbers are kept).
 */
export async function vaSetVariantStateAction(
  trialId: string,
  state: Exclude<VariantState, "scheduled_feed">,
  permalink?: string | null
) {
  const me = await requireRole("va", "owner", "admin");
  const db = supabaseAdmin();
  const { data: t } = await db.from("trial_posts").select("*").eq("id", trialId).maybeSingle();
  if (!t) return { error: "Variant not found." };
  const now = new Date().toISOString();
  const link = permalink === undefined ? (t.permalink as string | null) : permalink?.trim() || null;
  const before = variantState(t);
  let patch: Record<string, unknown>;

  switch (state) {
    case "to_trial":
      patch = { status: "planned", post_as: "trial", posted_at: null, promoted_job_id: null };
      break;
    case "to_feed":
      patch = { status: "planned", post_as: "main", posted_at: null, promoted_job_id: null };
      break;
    case "trial_posted":
      patch = { status: "posted", post_as: "trial", posted_at: t.posted_at ?? now, posted_by: t.posted_by ?? me.id, promoted_job_id: null };
      break;
    case "feed_posted":
      patch = {
        status: "posted",
        post_as: "main",
        posted_at: t.posted_at ?? now,
        posted_by: t.posted_by ?? me.id,
        permalink: link,
        ...(before === "trial_posted" ? { winner: true } : {}),
      };
      break;
    default:
      return { error: "Unknown status." };
  }

  // Leaving "scheduled" by hand takes the post off Instagram's schedule.
  if (before === "scheduled_feed" && t.promoted_job_id) {
    await db.from("publish_jobs").update({ status: "cancelled" }).eq("id", t.promoted_job_id).eq("status", "scheduled");
  }
  const { error } = await db.from("trial_posts").update(patch).eq("id", trialId);
  if (error) return { error: error.message };

  let linked = false;
  if (state === "feed_posted") linked = await linkMainFeedAnalytics(t.video_id as string, link);
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
  if (!note) return { error: "Say what's not quite right, so they know what to look at." };
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
