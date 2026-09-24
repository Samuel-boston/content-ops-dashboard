/**
 * A small, dependency-free client for Publer's API (https://publer.com/docs).
 *
 * Kept free of server-only imports and of the database so it can be exercised
 * against a fake Publer in a script. The server-side wrapper that reads the
 * saved credentials lives in `lib/integrations/publer.ts`.
 *
 * Publer's docs are thin in places (what a finished media-import job returns,
 * what the post list returns), so every read of a response here is defensive:
 * it accepts the documented shape and the obvious variants, and when it can't
 * find what it needs the error says what Publer actually sent.
 */

export interface PublerCreds {
  apiKey: string;
  /** Sent as `Publer-Workspace-Id`. Not needed to list workspaces. */
  workspaceId?: string | null;
  /** Test hook; defaults to Publer's production API. */
  baseUrl?: string;
}

export class PublerError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "PublerError";
    this.status = status;
  }
}

export interface PublerWorkspace {
  id: string;
  name: string;
  plan?: string;
}

export interface PublerAccount {
  id: string;
  provider: string;
  name: string;
  type?: string;
  picture?: string;
}

const DEFAULT_BASE = "https://app.publer.com/api/v1";
/** Publer's documented ceiling for a direct multipart upload. */
export const DIRECT_UPLOAD_LIMIT_BYTES = 190 * 1024 * 1024;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function base(c: PublerCreds) {
  return (c.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
}

function headers(c: PublerCreds, withWorkspace: boolean, json = true): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer-API ${c.apiKey}`, Accept: "application/json" };
  if (json) h["Content-Type"] = "application/json";
  if (withWorkspace && c.workspaceId) h["Publer-Workspace-Id"] = c.workspaceId;
  return h;
}

/** Turn Publer's error body into a sentence a person can act on. */
function explain(status: number, body: string): string {
  let detail = body.trim();
  try {
    const j = JSON.parse(body);
    const errs = j?.errors ?? j?.error ?? j?.message;
    detail = Array.isArray(errs) ? errs.join("; ") : typeof errs === "string" ? errs : detail;
  } catch {
    // not JSON — keep the raw text
  }
  detail = detail.slice(0, 300);
  if (status === 401) return "Publer didn't accept that API key. Copy it again from Publer → Settings → Access & Login → API Keys.";
  if (status === 403)
    return `Publer refused this: the API key is missing a permission, or the plan isn't Business. When you create the key tick workspaces, accounts, posts and media. ${detail}`.trim();
  if (status === 429) return "Publer says too many requests. Wait a minute and try again.";
  return `Publer said ${status}${detail ? `: ${detail}` : ""}`;
}

async function call<T = unknown>(
  c: PublerCreds,
  path: string,
  init: { method?: string; body?: BodyInit; json?: unknown; withWorkspace?: boolean } = {}
): Promise<T> {
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
  const res = await fetch(`${base(c)}${path}`, {
    method: init.method ?? (init.json !== undefined || init.body ? "POST" : "GET"),
    headers: headers(c, init.withWorkspace ?? true, !isForm),
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  }).catch((e) => {
    throw new PublerError(`Couldn't reach Publer: ${(e as Error).message}`);
  });
  const text = await res.text();
  if (!res.ok) throw new PublerError(explain(res.status, text), res.status);
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new PublerError(`Publer sent something unreadable: ${text.slice(0, 200)}`, res.status);
  }
}

/** Arrays come back bare or wrapped, depending on the endpoint. */
function asArray<T>(x: unknown, ...keys: string[]): T[] {
  if (Array.isArray(x)) return x as T[];
  if (x && typeof x === "object") {
    for (const k of ["data", ...keys]) {
      const v = (x as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v as T[];
    }
  }
  return [];
}

// ---- Connecting ------------------------------------------------------------

export async function listWorkspaces(c: PublerCreds): Promise<PublerWorkspace[]> {
  const raw = await call(c, "/workspaces", { withWorkspace: false });
  return asArray<Record<string, unknown>>(raw, "workspaces")
    .filter((w) => w && typeof w.id === "string")
    .map((w) => ({ id: w.id as string, name: (w.name as string) || "Workspace", plan: w.plan as string | undefined }));
}

export async function listAccounts(c: PublerCreds): Promise<PublerAccount[]> {
  const raw = await call(c, "/accounts");
  return asArray<Record<string, unknown>>(raw, "accounts")
    .filter((a) => a && typeof a.id === "string")
    .map((a) => ({
      id: a.id as string,
      provider: String(a.provider ?? "").toLowerCase(),
      name: (a.name as string) || "Account",
      type: a.type as string | undefined,
      picture: a.picture as string | undefined,
    }));
}

// ---- Jobs ------------------------------------------------------------------

export interface PublerJobResult {
  state: "working" | "complete" | "failed";
  /** Human-readable failure lines, when there are any. */
  failures: string[];
  raw: unknown;
}

/** Publer reports failures as `{}` (none), an object, or a list of `{message,…}`. */
export function readFailures(payload: unknown): string[] {
  const f = (payload as { failures?: unknown } | null)?.failures;
  if (!f) return [];
  const items = Array.isArray(f) ? f : typeof f === "object" ? Object.values(f as object) : [];
  const lines: string[] = [];
  for (const it of items.flat()) {
    if (!it) continue;
    if (typeof it === "string") lines.push(it);
    else {
      const o = it as { message?: string; account_name?: string; provider?: string };
      lines.push([o.account_name ?? o.provider, o.message].filter(Boolean).join(": ") || JSON.stringify(it));
    }
  }
  return lines;
}

export async function jobStatus(c: PublerCreds, jobId: string): Promise<PublerJobResult> {
  const raw = await call<Record<string, unknown>>(c, `/job_status/${encodeURIComponent(jobId)}`);
  const data = (raw.data as Record<string, unknown> | undefined) ?? raw;
  const result = (data.result as Record<string, unknown> | undefined) ?? undefined;
  const outer = String(data.status ?? "").toLowerCase();
  const inner = String(result?.status ?? "").toLowerCase();
  const payload = (result?.payload ?? data.payload) as unknown;
  const failures = readFailures(payload);
  let state: PublerJobResult["state"] = "working";
  if (outer === "failed" || inner === "failed") state = "failed";
  else if (outer === "complete" && (inner === "" || inner === "complete")) state = "complete";
  // A job can finish "complete" while listing accounts it couldn't post to.
  if (state === "complete" && failures.length) state = "failed";
  return { state, failures, raw };
}

export async function waitForJob(
  c: PublerCreds,
  jobId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<PublerJobResult> {
  const deadline = Date.now() + (opts.timeoutMs ?? 240_000);
  const interval = opts.intervalMs ?? 3000;
  for (;;) {
    const r = await jobStatus(c, jobId);
    if (r.state !== "working") return r;
    if (Date.now() > deadline) throw new PublerError("Publer is still working on it. Check Publer for the post before trying again.");
    await sleep(interval);
  }
}

function jobIdOf(x: unknown): string | null {
  const o = x as { job_id?: string; data?: { job_id?: string } } | null;
  return o?.job_id ?? o?.data?.job_id ?? null;
}

// ---- Media -----------------------------------------------------------------

export interface PublerMedia {
  id: string;
  path?: string;
  type?: string;
  /** Set when Publer says the file can't go out as an Instagram Reel. */
  reelOk: boolean | null;
}

function readMedia(o: Record<string, unknown>): PublerMedia {
  const v = (o.validity as { instagram?: { reel?: boolean } } | undefined)?.instagram?.reel;
  return { id: String(o.id), path: o.path as string | undefined, type: (o.type as string) || "video", reelOk: typeof v === "boolean" ? v : null };
}

/** Find the first object that looks like an uploaded media item anywhere in a response. */
export function findMedia(x: unknown, depth = 0): PublerMedia | null {
  if (!x || typeof x !== "object" || depth > 6) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id === "string" && ("path" in o || "thumbnail" in o || "validity" in o || o.type === "video")) return readMedia(o);
  for (const v of Object.values(o)) {
    const hit = findMedia(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** Upload a file's bytes (up to Publer's 200 MB direct-upload limit). */
export async function uploadMedia(c: PublerCreds, file: Blob, filename: string): Promise<PublerMedia> {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("in_library", "false");
  const raw = await call<unknown>(c, "/media", { body: form });
  const media = findMedia(raw);
  if (!media) throw new PublerError(`Publer accepted the upload but didn't return a media id: ${JSON.stringify(raw).slice(0, 200)}`);
  return media;
}

/** Ask Publer to fetch a file from a public address itself (for files too big to upload directly). */
export async function importMediaFromUrl(c: PublerCreds, url: string, name: string): Promise<PublerMedia> {
  const started = await call<unknown>(c, "/media/from-url", {
    json: { media: [{ url, name }], type: "single", direct_upload: false, in_library: false },
  });
  const jobId = jobIdOf(started);
  const inline = findMedia(started);
  if (inline) return inline;
  if (!jobId) throw new PublerError(`Publer didn't start the import: ${JSON.stringify(started).slice(0, 200)}`);
  const done = await waitForJob(c, jobId, { timeoutMs: 270_000 });
  if (done.state === "failed") throw new PublerError(`Publer couldn't import the video: ${done.failures.join("; ") || "no reason given"}`);
  const media = findMedia(done.raw);
  if (!media) {
    throw new PublerError(
      "Publer imported the video but the reply didn't include its media id. The cut is over 200 MB — compress it under that and try again."
    );
  }
  return media;
}

// ---- Posting ---------------------------------------------------------------

export interface ReelPost {
  accountId: string;
  media: PublerMedia;
  caption: string;
  /** Post as an Instagram trial reel, with how it graduates. Omit for a normal Reel. */
  trial?: "MANUAL" | "SS_PERFORMANCE";
  /** Also show in the profile grid. Ignored for a trial. */
  shareToFeed?: boolean;
  /** ISO instant; omit to publish now. */
  scheduledAt?: string;
}

export function reelBody(p: ReelPost) {
  return {
    bulk: {
      state: "scheduled",
      posts: [
        {
          networks: {
            instagram: {
              type: "video",
              text: p.caption,
              media: [{ id: p.media.id, ...(p.media.path ? { path: p.media.path } : {}), type: "video" }],
              details: {
                type: "reel",
                feed: p.trial ? false : (p.shareToFeed ?? true),
                ...(p.trial ? { trial_reel: p.trial } : {}),
              },
            },
          },
          accounts: [{ id: p.accountId, ...(p.scheduledAt ? { scheduled_at: p.scheduledAt } : {}) }],
        },
      ],
    },
  };
}

export type VideoNetwork = "instagram" | "youtube" | "tiktok" | "linkedin";

export interface VideoPost {
  network: VideoNetwork;
  accountId: string;
  media: PublerMedia;
  caption: string;
  /** YouTube needs a title. */
  title?: string;
  trial?: "MANUAL" | "SS_PERFORMANCE";
  shareToFeed?: boolean;
  /** YouTube: a Short (default) or a regular video. */
  youtubeKind?: "short" | "video";
  scheduledAt?: string;
}

/**
 * The request body for a video going to any supported network. Instagram is a
 * Reel (or trial reel); YouTube is a Short by default (Publer documents that
 * shape); TikTok and LinkedIn take a plain video post.
 */
export function videoBody(p: VideoPost) {
  if (p.network === "instagram") {
    return reelBody({
      accountId: p.accountId,
      media: p.media,
      caption: p.caption,
      trial: p.trial,
      shareToFeed: p.shareToFeed,
      scheduledAt: p.scheduledAt,
    });
  }
  const media = [{ id: p.media.id, ...(p.media.path ? { path: p.media.path } : {}), type: "video" }];
  const network: Record<string, unknown> =
    p.network === "youtube"
      ? {
          type: "video",
          title: (p.title || p.caption || "Video").slice(0, 100),
          text: p.caption,
          media,
          details: { type: p.youtubeKind ?? "short", privacy: "public" },
        }
      : { type: "video", text: p.caption, media };
  return {
    bulk: {
      state: "scheduled",
      posts: [
        {
          networks: { [p.network]: network },
          accounts: [{ id: p.accountId, ...(p.scheduledAt ? { scheduled_at: p.scheduledAt } : {}) }],
        },
      ],
    },
  };
}

/** Send a video to one network through Publer and wait for Publer to finish. Publishes now unless `scheduledAt` is set. */
export async function publishVideo(c: PublerCreds, p: VideoPost): Promise<{ jobId: string }> {
  if (p.network === "instagram") {
    if (p.media.reelOk === false) {
      throw new PublerError("Publer says this video can't go out as an Instagram Reel. Reels need to be vertical (9:16) and 3 to 90 seconds.");
    }
  }
  const path = p.scheduledAt ? "/posts/schedule" : "/posts/schedule/publish";
  const started = await call<unknown>(c, path, { json: videoBody(p) });
  const jobId = jobIdOf(started);
  if (!jobId) throw new PublerError(`Publer didn't accept the ${p.network} post: ${JSON.stringify(started).slice(0, 200)}`);
  const done = await waitForJob(c, jobId);
  if (done.state === "failed") {
    throw new PublerError(`Publer couldn't post it to ${p.network}: ${done.failures.join("; ") || "no reason given"}`);
  }
  return { jobId };
}

/** Send a Reel. Publishes now when there's no `scheduledAt`. Returns Publer's job id once it has finished. */
export async function publishReel(c: PublerCreds, p: ReelPost): Promise<{ jobId: string }> {
  if (p.media.reelOk === false) {
    throw new PublerError("Publer says this video can't go out as an Instagram Reel. Reels need to be vertical (9:16) and 3 to 90 seconds.");
  }
  const path = p.scheduledAt ? "/posts/schedule" : "/posts/schedule/publish";
  const started = await call<unknown>(c, path, { json: reelBody(p) });
  const jobId = jobIdOf(started);
  if (!jobId) throw new PublerError(`Publer didn't accept the post: ${JSON.stringify(started).slice(0, 200)}`);
  const done = await waitForJob(c, jobId);
  if (done.state === "failed") {
    throw new PublerError(`Publer couldn't post it: ${done.failures.join("; ") || "no reason given"}`);
  }
  return { jobId };
}
