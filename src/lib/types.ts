export type Role = "owner" | "admin" | "editor" | "copywriter" | "va";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  active: boolean;
  notify_mode: "realtime" | "digest" | "off";
  /** Watermark for "what's new" on the Overview. Null until the first visit. */
  overview_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The pipeline.
 *
 * `ideation` and `scripting` are the client's private planning stages —
 * editors can't see them at all (enforced in RLS, not just hidden).
 *
 * There is no "claimed" stage: assigning an editor IS the move to in_progress.
 *
 * `approved` is a decision, not a resting place. A database trigger routes it
 * onward the instant it's set — to `awaiting_variants` when the script has more
 * than one hook (or the client forced it), otherwise straight to
 * `ready_to_post`. No video ever sits in `approved`.
 */
export type VideoStatus =
  | "ideation"
  | "scripting"
  | "script_review"
  | "script_revisions"
  | "needs_creatives"
  | "creative_review"
  | "creative_revisions"
  | "ready_to_film"
  | "editor_brief"
  | "ready_to_edit"
  | "in_progress"
  | "in_review"
  | "revisions"
  | "approved"
  | "awaiting_variants"
  | "final_review"
  | "ready_to_post"
  | "with_va"
  | "posted";

export const STATUS_LABELS: Record<VideoStatus, string> = {
  ideation: "Ideation",
  scripting: "Scripting",
  script_review: "Script Review",
  script_revisions: "Script Revisions",
  needs_creatives: "Needs Creatives",
  creative_review: "Creatives to Review",
  creative_revisions: "Creative Revisions",
  ready_to_film: "Ready to Film",
  editor_brief: "Editor Brief",
  ready_to_edit: "Ready to Edit",
  in_progress: "Editing",
  in_review: "In Review",
  revisions: "Revisions",
  approved: "Approved",
  awaiting_variants: "Awaiting Variants",
  final_review: "Final Review",
  ready_to_post: "Ready to Post",
  with_va: "With the VA",
  posted: "Posted",
};

/** Whose court the ball is in at each stage — drives the "who's blocking" copy. */
export const STATUS_OWNER: Record<VideoStatus, "client" | "editor" | "va" | "done"> = {
  ideation: "client",
  scripting: "client",
  script_review: "client",
  script_revisions: "editor",
  needs_creatives: "client",
  creative_review: "client",
  creative_revisions: "editor",
  ready_to_film: "client",
  editor_brief: "client",
  ready_to_edit: "editor",
  in_progress: "editor",
  in_review: "client",
  revisions: "editor",
  approved: "client",
  awaiting_variants: "editor",
  final_review: "client",
  ready_to_post: "client",
  with_va: "va",
  posted: "done",
};

/** The client's board. Posted drops off into the archive; approved is transient. */
export const ACTIVE_STATUSES: VideoStatus[] = [
  "ideation",
  "scripting",
  "script_review",
  "script_revisions",
  "needs_creatives",
  "creative_review",
  "creative_revisions",
  "ready_to_film",
  "editor_brief",
  "ready_to_edit",
  "in_progress",
  "in_review",
  "revisions",
  "awaiting_variants",
  "final_review",
  "ready_to_post",
  "with_va",
];

/** What an editor's board shows — the stages they can actually act on. */
export const EDITOR_STATUSES: VideoStatus[] = [
  "ready_to_edit",
  "in_progress",
  "revisions",
  "awaiting_variants",
];

/**
 * The stages an editor is allowed to move a video into.
 *
 * This is the exact complement of the blocklist in `videos_guard_columns()`
 * (migration 009). Keep the two in step: offering a stage here that the guard
 * rejects produces a database error where a disabled option belonged.
 */
export const EDITOR_SETTABLE_STATUSES: VideoStatus[] = [
  "ready_to_edit",
  "in_progress",
  "in_review",
  "revisions",
  "awaiting_variants",
];

/**
 * Client-only stages. Editors can't see these at all (enforced in RLS).
 * creative_review/creative_revisions are carousel-only and deliberately NOT
 * here — they don't route to the /idea or /script rooms this list feeds,
 * they route to CarouselPostView instead (see videos/[id]/page.tsx).
 */
export const PLANNING_STAGES: VideoStatus[] = [
  "ideation",
  "scripting",
  "script_review",
  "script_revisions",
  "ready_to_film",
  "editor_brief",
];

/**
 * The copywriter's world: the stages they can see (everything up to Ready to
 * Film), and the subset they can move a script between. Approving a script —
 * Script Review → Ready to Film — is the client's call, and the DB guard
 * trigger (migration 027) enforces exactly this split. Keep the two in step,
 * the same way EDITOR_SETTABLE_STATUSES mirrors the editor blocklist.
 */
export const COPYWRITER_STATUSES: VideoStatus[] = [
  "ideation",
  "scripting",
  "script_review",
  "script_revisions",
  "ready_to_film",
];
export const COPYWRITER_SETTABLE_STATUSES: VideoStatus[] = [
  "ideation",
  "scripting",
  "script_review",
];

/** Stages where the editor owes the client an ETA before picking the work up. */
export const ETA_STAGES: VideoStatus[] = ["in_progress", "revisions", "awaiting_variants"];

export const STATUS_ORDER: VideoStatus[] = [...ACTIVE_STATUSES, "posted"];

/**
 * The stage a video came from, for undoing a move.
 *
 * `approved` is skipped: it's transient — a trigger immediately routes it on
 * to Awaiting Variants or Ready to Post — so stepping back into it would be
 * bounced straight out again. Stepping back from either of those lands on
 * In Review, which is where the decision was actually made.
 */
export function previousStage(status: VideoStatus, carousel = false): VideoStatus | null {
  // A carousel's life past Script Review is entirely its own: Script Review
  // -> Creative Review -> Ready to Post, no filming, brief, or edit chain.
  // Checked first: a plain video's "ready_to_post -> in_review" rule below
  // would otherwise win and send a carousel somewhere it never was.
  // These three stages only ever exist for carousels, so they count as one
  // even when the caller didn't say so.
  const carouselOnly = status === "needs_creatives" || status === "creative_review" || status === "creative_revisions";
  if (carousel || carouselOnly) {
    if (status === "needs_creatives") return "script_review";
    if (status === "creative_review") return "needs_creatives";
    if (status === "creative_revisions") return "creative_review";
    if (status === "ready_to_post") return "creative_review";
    if (status === "editor_brief") return "script_review"; // legacy safety net
  }
  // A video's script goes straight from Script Review to Ready to Film, so the
  // step before Ready to Film is Scripting — never the carousel-only stages
  // that sit between them in the stage order.
  if (status === "ready_to_film") return "scripting";
  // With the VA is a step out from Ready to Post: taking it back lands there.
  if (status === "with_va") return "ready_to_post";
  if (status === "awaiting_variants" || status === "ready_to_post") return "in_review";
  if (status === "revisions") return "in_review";
  const i = STATUS_ORDER.indexOf(status);
  if (i <= 0) return null;
  const prev = STATUS_ORDER[i - 1];
  return prev === "approved" ? "in_review" : prev;
}

/**
 * Column rail / pill colour per stage. Kept as raw CSS values (not Tailwind
 * class names) because they're applied inline to dynamically-coloured rails
 * and dots, which Tailwind can't statically extract.
 */
export const STATUS_COLOR: Record<VideoStatus, string> = {
  ideation: "var(--color-stage-ideation)",
  scripting: "var(--color-stage-scripting)",
  script_review: "var(--color-stage-script-review)",
  script_revisions: "var(--color-stage-script-revisions)",
  needs_creatives: "var(--color-stage-needs-creatives)",
  creative_review: "var(--color-stage-creative-review)",
  creative_revisions: "var(--color-stage-creative-revisions)",
  ready_to_film: "var(--color-stage-film)",
  editor_brief: "var(--color-stage-brief)",
  ready_to_edit: "var(--color-stage-ready)",
  in_progress: "var(--color-stage-progress)",
  in_review: "var(--color-stage-review)",
  revisions: "var(--color-stage-revisions)",
  approved: "var(--color-stage-approved)",
  awaiting_variants: "var(--color-stage-variants)",
  final_review: "var(--color-stage-final)",
  ready_to_post: "var(--color-stage-ready-post)",
  with_va: "var(--color-stage-with-va)",
  posted: "var(--color-stage-posted)",
};

export interface Series {
  id: string;
  title: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface SeriesWithVideos extends Series {
  videos: VideoWithEditor[];
}

export type Priority = "urgent" | "high" | "standard";

export const PRIORITY_LABELS: Record<Priority, string> = {
  urgent: "Urgent",
  high: "High",
  standard: "Standard",
};

export const PRIORITY_ORDER: Priority[] = ["urgent", "high", "standard"];

/** Higher = surfaces first in the Ready to Edit queue. */
export const PRIORITY_RANK: Record<Priority, number> = {
  urgent: 3,
  high: 2,
  standard: 1,
};

export interface Video {
  id: string;
  title: string;
  status: VideoStatus;
  priority: Priority;
  assigned_editor_id: string | null;
  content_pillars: string[];
  formats: string[];
  platforms: string[];
  post_date: string | null;
  posted_at: string | null;
  frameio_url: string | null;
  brief: string | null;
  /** Free-form thinking from Ideation, before there's a script to write. */
  idea_notes: string | null;
  needs_script: boolean;
  script_hooks: string[];
  script_body: string | null;
  script_cta: string | null;
  stage_entered_at: string;
  /** When it was last handed to an editor — the month it counts toward for pay. */
  assigned_at: string | null;
  /** A named run of videos released in order; null when it stands alone. */
  series_id: string | null;
  series_position: number | null;
  /** Shelved for later: keeps its stage, drops out of every board and count. */
  parked_at: string | null;
  parked_reason: string | null;
  raw_footage_url: string | null;
  drive_file_url: string | null;
  /** The video's own folder in the Drive archive (<month>/<title>/). */
  drive_folder_url: string | null;
  archived_at: string | null;
  /** Generated column: urgent=3, high=2, standard=1. Ordering happens on this. */
  priority_rank: number;
  /**
   * Sparse manual order within a board column. NULL = never hand-placed, which
   * sorts by priority then age (the Ready to Edit queue's original behaviour).
   */
  board_position: number | null;

  /** The editor's promised delivery for the stage they're currently in. */
  eta_at: string | null;
  /** Which stage the ETA was given for — cleared automatically on any move. */
  eta_stage: VideoStatus | null;
  eta_set_by: string | null;
  eta_set_at: string | null;

  /** null = derive from the script's hook count; true/false = client override. */
  variants_override: boolean | null;
  /** Generated: does this video need hook variants before it can go out? */
  needs_variants: boolean;

  /**
   * Art direction shared by every slide of a carousel — the "prompt context"
   * for AI slide generation. On the video (not per slide) so a 10-slide
   * carousel reads as one designed piece.
   */
  carousel_style: string | null;

  /** Spoken brief recorded by the client. Signed URLs are minted per-request
   *  (see `briefVoiceUrl()` in script-actions.ts) and passed down explicitly
   *  as a prop — never stored, and never a field on this type. */
  brief_voice_path: string | null;
  /** Instructions for the VA, written when the video is sent to them to post. */
  va_notes: string | null;
  /** The video's shared caption (Post tab) — used by any variant without its own. */
  post_caption: string | null;
  /** Cover image (footage bucket) the VA uses when posting. */
  cover_path: string | null;
  /** When it was sent to the VA — null until then. */
  va_sent_at: string | null;
  brief_voice_duration_seconds: number | null;
  brief_voice_peaks: number[] | null;

  /** Snapshot taken when posted, so later rate changes never rewrite history. */
  price_cents: number | null;
  price_breakdown: PriceBreakdown | null;
  priced_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PriceBreakdown {
  total_cents: number;
  base_cents?: number;
  format?: string | null;
  variants?: number;
  extra_variants?: number;
  surcharge_cents?: number;
  reason?: string;
}

/** What one editor is paid for one format. Owner writes; editor reads own. */
export interface EditorRate {
  id: string;
  editor_id: string;
  format: string;
  price_cents: number;
  updated_by: string | null;
  updated_at: string;
}

export interface VideoAsset {
  id: string;
  video_id: string;
  kind: "raw" | "other" | "delivery";
  label: string;
  storage_path: string | null;
  drive_url: string | null;
  external_url: string | null;
  size_bytes: number | null;
  added_by: string | null;
  created_at: string;
  signed_url?: string;
}

/** One image of a "Carousel with text" post — the deliverable, ordered by `position`. */
export interface CarouselImage {
  id: string;
  video_id: string;
  position: number;
  storage_path: string | null;
  size_bytes: number | null;
  /** The slide's own on-image text — written at the scripting stage, often before an image exists. */
  caption: string | null;
  uploaded_by: string | null;
  created_at: string;
  /** The instruction the last AI generation ran with; null = uploaded by hand. */
  gen_prompt: string | null;
  gen_at: string | null;
  /** Library shots (footage index) sent along as image references when generating. */
  ref_shot_ids: string[];
  signed_url?: string;
}

export interface VideoActivity {
  id: string;
  video_id: string;
  actor_id: string | null;
  kind: string;
  summary: string;
  created_at: string;
  actor?: Pick<Profile, "id" | "full_name" | "email"> | null;
}

/** Video joined with its assigned editor's profile (for board rows). */
export interface VideoWithEditor extends Video {
  assigned_editor: Pick<Profile, "id" | "full_name" | "email"> | null;
}

/** A board card: the video plus the main cut's current state. */
export interface BoardCard extends VideoWithEditor {
  thumbnail_url: string | null;
  duration_seconds: number | null;
  version: number | null;
  open_comments: number;
}

export interface TaxonomyOption {
  id: string;
  kind: "content_pillar" | "format" | "platform";
  value: string;
  created_by: string | null;
  created_at: string;
}

// How long a video can sit in one stage before it's flagged as stalled.
export const STALLED_AFTER_DAYS: Partial<Record<VideoStatus, number>> = {
  ideation: 14,
  scripting: 10,
  script_review: 3,
  script_revisions: 3,
  needs_creatives: 5,
  creative_review: 3,
  creative_revisions: 3,
  ready_to_film: 7,
  ready_to_edit: 7,
  in_progress: 5,
  in_review: 4,
  revisions: 4,
  awaiting_variants: 3,
  final_review: 3,
  ready_to_post: 5,
  with_va: 5,
};

export function isStalled(video: Pick<Video, "status" | "stage_entered_at">): boolean {
  const limit = STALLED_AFTER_DAYS[video.status];
  if (!limit) return false;
  const ageMs = Date.now() - new Date(video.stage_entered_at).getTime();
  return ageMs > limit * 24 * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Video engine
// ---------------------------------------------------------------------------

export type CutKind = "main" | "hook";
export type VersionStatus = "uploading" | "processing" | "ready" | "errored";

export interface VideoCut {
  id: string;
  video_id: string;
  kind: CutKind;
  label: string;
  notes: string | null;
  position: number;
  created_by: string | null;
  created_at: string;
}

export interface CutVersion {
  id: string;
  cut_id: string;
  version: number;
  stream_uid: string | null;
  status: VersionStatus;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  playback_url: string | null;
  drive_file_url: string | null;
  /** The untouched upload (Stream only keeps a re-encoded copy): in Storage until mirrored, then in Drive. */
  original_path: string | null;
  original_drive_url: string | null;
  original_name: string | null;
  original_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
}

/** Internal = team-only. Client = what a client portal would be allowed to show. */
export type CommentVisibility = "internal" | "client";

/**
 * One freehand stroke of a drawn annotation. Points are normalised 0..1
 * against the video frame, so a drawing made on a phone renders correctly on a
 * 4K display and survives a re-encode at a different resolution.
 */
export interface DrawStroke {
  color: string;
  width: number;
  points: [number, number][];
  /**
   * Seconds from the start of the voice note, when the stroke was drawn.
   * Present only for annotations recorded while talking — playback then
   * reveals each stroke at the moment it was made.
   */
  t?: number;
}

export interface Drawing {
  strokes: DrawStroke[];
  /** Frame aspect the drawing was made against, for letterboxed playback. */
  aspect?: number;
}

export interface CommentAttachment {
  path: string;
  name: string;
  size: number;
  type: string;
  /** Minted server-side at read time; never stored. */
  signed_url?: string;
}

export interface CutComment {
  id: string;
  cut_id: string;
  version: number | null;
  parent_comment_id: string | null;
  author_id: string | null;
  body: string;
  t_start_seconds: number | null;
  t_end_seconds: number | null;
  mentions: string[];
  resolved: boolean;
  created_at: string;
  visibility: CommentVisibility;
  assignee_id: string | null;
  drawing: Drawing | null;
  voice_path: string | null;
  voice_duration_seconds: number | null;
  /** Waveform peaks (0..1) captured at record time so playback draws instantly. */
  voice_peaks: number[] | null;
  attachments: CommentAttachment[];
  author?: Pick<Profile, "id" | "full_name" | "email" | "role"> | null;
  assignee?: Pick<Profile, "id" | "full_name" | "email" | "role"> | null;
  /** Minted server-side at read time; never stored. */
  voice_url?: string;
}

export interface TranscriptCue {
  start: number;
  end: number;
  text: string;
}

export interface CutTranscript {
  id: string;
  cut_id: string;
  version: number;
  language: string;
  cues: TranscriptCue[];
  source: string;
  created_by: string | null;
  created_at: string;
}

export interface CutWithVersions extends VideoCut {
  versions: CutVersion[];
}

// ---------------------------------------------------------------------------
// Chat / notifications
// ---------------------------------------------------------------------------

export interface VideoMessage {
  id: string;
  video_id: string;
  author_id: string | null;
  body: string;
  mentions: string[];
  created_at: string;
  author?: Pick<Profile, "id" | "full_name" | "email"> | null;
}

export type NotificationKind =
  | "assignment"
  | "mention"
  | "revision"
  | "comment"
  | "stalled"
  | "system";

export interface AppNotification {
  id: string;
  user_id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  video_id: string | null;
  read: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export interface MusicTrack {
  id: string;
  title: string;
  category: string;
  storage_path: string;
  duration_seconds: number | null;
  uploaded_by: string | null;
  created_at: string;
  mood: string | null;
  energy: string | null;
  bpm: number | null;
  signed_url?: string;
  /** Videos this track has been attached to — populated on the library page. */
  used_on?: { id: string; title: string; post_date: string | null }[];
}

export const MOODS = [
  "Upbeat", "Chill", "Dramatic", "Emotional", "Corporate", "Cinematic", "Funny", "Tense",
] as const;

export const ENERGY_LEVELS = ["Low", "Medium", "High"] as const;

/** A track attached to a video — the only thing that feeds "where it's been used". */
export interface VideoMusic {
  id: string;
  video_id: string;
  track_id: string;
  added_by: string | null;
  created_at: string;
  track?: MusicTrack;
}

/** Optional. Nobody is ever required to declare availability. */
export interface TimeOff {
  id: string;
  editor_id: string;
  starts_on: string;
  ends_on: string;
  note: string | null;
  created_at: string;
}

export interface EditorPayment {
  id: string;
  editor_id: string;
  /** "YYYY-MM" */
  month: string;
  amount_cents: number;
  note: string | null;
  paid_at: string;
  paid_by: string | null;
}

export interface GuestLink {
  id: string;
  video_id: string;
  token: string;
  label: string | null;
  /**
   * review  = watch and comment
   * upload  = send footage in from a phone
   * assets  = the reverse — hand a phone a downloadable package (brief,
   *           footage, references) instead of asking for something back.
   *           For a trial or freelance editor with no dashboard login.
   */
  purpose: "review" | "upload" | "assets";
  expires_at: string | null;
  revoked: boolean;
  created_by: string | null;
  created_at: string;
}

export interface HookSnippet {
  id: string;
  text: string;
  note: string | null;
  source_video_id: string | null;
  times_used: number;
  created_by: string | null;
  created_at: string;
}

export type ReferenceStatus = "open" | "used" | "dismissed" | "archived";

export interface ReferenceItem {
  id: string;
  video_id: string | null;
  kind: "image" | "link" | "video";
  storage_path: string | null;
  url: string | null;
  note: string | null;
  status: ReferenceStatus;
  added_by: string | null;
  last_activity_at: string;
  archived_at: string | null;
  created_at: string;
  signed_url?: string;
}

export interface SopDoc {
  id: string;
  title: string;
  format: string | null;
  body: string;
  position: number;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Analytics / publishing
// ---------------------------------------------------------------------------

export interface VideoMetrics {
  id: string;
  video_id: string;
  source: string;
  external_media_id: string | null;
  permalink: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  reach: number | null;
  fetched_at: string;
}

export type PublishStatus =
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled";

/** Channels the Post tab can target. Only Instagram actually publishes today. */
export const PUBLISH_CHANNELS = ["instagram", "tiktok", "linkedin", "youtube"] as const;
export type PublishChannel = (typeof PUBLISH_CHANNELS)[number];

export const CHANNEL_LABELS: Record<PublishChannel, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  youtube: "YouTube",
};

export interface PublishJob {
  id: string;
  video_id: string;
  cut_id: string | null;
  channels: string[];
  caption: string | null;
  scheduled_for: string | null;
  status: PublishStatus;
  ig_creation_id: string | null;
  ig_media_id: string | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
  published_at: string | null;
  cover_offset_ms: number;
  share_to_feed: boolean;
}

// ---------------------------------------------------------------------------
// Workspace settings (integration config — Owner only)
// ---------------------------------------------------------------------------

export interface WorkspaceSettings {
  id: number;
  cf_account_id: string | null;
  cf_stream_token: string | null;
  cf_stream_customer_code: string | null;
  drive_folder_id: string | null;
  drive_service_account: unknown;
  ig_user_id: string | null;
  ig_access_token: string | null;
  ig_token_expires_at: string | null;
  telegram_bot_token: string | null;
  telegram_chat_ids: number[];
  telegram_user_ids: number[];
  openai_api_key: string | null;
  /** AI scripting (hooks/drafts/captions/ideas) — Groq's free tier by default. */
  groq_api_key: string | null;
  /** Which engine actually runs AI scripting. openai here means "reuse openai_api_key as a chat model", not Whisper — that use is separate and always active regardless of this setting. */
  ai_provider: "groq" | "anthropic" | "openai";
  /** Real Claude, when ai_provider is "anthropic". */
  anthropic_api_key: string | null;
  /** Surcharge per hook variant beyond the first ("4 variants = 3 extra"). */
  hook_variant_surcharge_cents: number;
  currency: string;
  /** Shown in the nav. Falls back to "Content Ops" when unset. */
  brand_name: string | null;
  /** The client's first name, used in copy shown to the team ("Adam is reviewing"). */
  client_name: string | null;
  /** Object key inside the public `branding` bucket. */
  brand_logo_path: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface IntegrationStatus {
  stream: boolean;
  drive: boolean;
  instagram: boolean;
  telegram: boolean;
  whisper: boolean;
  ai: boolean;
  email: boolean;
}

// ---------------------------------------------------------------------------
// The editor's side
// ---------------------------------------------------------------------------

/**
 * One folder in the client's Drive b-roll library. The media never enters this
 * system — this is an index so an editor can find the right folder fast.
 */
export interface BrollCategory {
  id: string;
  name: string;
  drive_url: string | null;
  note: string | null;
  position: number;
  created_by: string | null;
  created_at: string;
}

/** Where an editor wants to be paid. Owner-readable; other editors never see it. */
export interface EditorPaymentDetails {
  editor_id: string;
  payment_link: string | null;
  note: string | null;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Trial reels (hook testing) — migration 028
// ---------------------------------------------------------------------------

export type TrialStatus = "planned" | "posted" | "promoted" | "archived";

export const TRIAL_STATUS_LABELS: Record<TrialStatus, string> = {
  planned: "To post",
  posted: "Live trial",
  promoted: "Promoted",
  archived: "Archived",
};

/**
 * One trial-reel run of one hook variant. Posted by hand (Instagram's API can
 * neither post nor read trials) and measured by hand from the app's insights
 * screen; once promoted to the main feed, the normal publish_jobs →
 * video_metrics machinery takes over via `promoted_job_id`.
 */
export interface TrialPost {
  id: string;
  video_id: string;
  cut_id: string | null;
  label: string;
  caption: string | null;
  status: TrialStatus;
  scheduled_for: string | null;
  posted_at: string | null;
  posted_by: string | null;
  permalink: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  metrics_updated_at: string | null;
  metrics_updated_by: string | null;
  winner: boolean;
  promoted_job_id: string | null;
  notes: string | null;
  /** This variant's own cover image (footage bucket); the video-wide cover is the fallback. */
  cover_path: string | null;
  /** Where this variant goes: an Instagram trial reel, or straight to the main feed. */
  post_as: "trial" | "main" | "none";
  /** When it was handed to the VA — null while it's still a draft. */
  sent_to_va_at: string | null;
  created_by: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Footage index — mirror of the B-Roll Librarian archive (migration 030)
// ---------------------------------------------------------------------------

/**
 * One analysed shot from the client's footage archive: a video's Nth detected
 * shot or a photo. Synced up from the local B-Roll Librarian by
 * scripts/sync-broll-library.mjs; media stays in Drive, the thumbnail frame
 * lives in the `library-thumbs` bucket.
 */
export interface LibraryShot {
  id: string;
  source_id: string;
  media_kind: "video" | "image";
  filename: string | null;
  caption: string | null;
  action: string | null;
  setting: string | null;
  shot_type: string | null;
  emotions: string[];
  subjects: string[];
  category: string | null;
  featured_person: boolean;
  top_pick: boolean;
  start_s: number | null;
  end_s: number | null;
  duration_s: number | null;
  drive_file_id: string | null;
  drive_web_link: string | null;
  drive_path: string | null;
  thumb_path: string | null;
  search_text: string | null;
  synced_at: string;
  /** Minted server-side at read time; never stored. */
  thumb_url?: string;
}

// ---------------------------------------------------------------------------
// Script comments — notes on a specific part of a script (migration 035)
// ---------------------------------------------------------------------------

export interface ScriptComment {
  id: string;
  video_id: string;
  /** 'hook:0', 'hook:1', 'body', 'cta', 'slide:<slide id>' or 'general'. */
  target: string;
  /** The words it was made on, kept so the note still reads if the script moves. */
  quote: string | null;
  body: string;
  author_id: string | null;
  resolved: boolean;
  resolved_by: string | null;
  created_at: string;
  author?: Pick<Profile, "id" | "full_name" | "email" | "role"> | null;
}
