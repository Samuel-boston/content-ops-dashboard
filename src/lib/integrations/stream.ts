import "server-only";
import { getWorkspaceSettings } from "@/lib/workspace";

const CF_API = "https://api.cloudflare.com/client/v4";

export class NotConfiguredError extends Error {
  constructor(what: string) {
    super(`${what} is not configured. An Owner can add credentials in Settings → Integrations.`);
  }
}

async function cfConfig() {
  const s = await getWorkspaceSettings();
  if (!s.cf_account_id || !s.cf_stream_token || !s.cf_stream_customer_code) {
    throw new NotConfiguredError("Cloudflare Stream");
  }
  return {
    accountId: s.cf_account_id,
    token: s.cf_stream_token,
    customerCode: s.cf_stream_customer_code,
  };
}

export interface DirectUpload {
  uploadURL: string;
  uid: string;
}

/**
 * Ask Cloudflare for a one-time direct-upload URL. The browser uploads the file
 * straight to this URL — the bytes never touch our server. `maxDurationSeconds`
 * is required by Stream for direct creator uploads.
 */
export async function createDirectUpload(opts: {
  maxDurationSeconds?: number;
  name?: string;
  creator?: string;
}): Promise<DirectUpload> {
  const cf = await cfConfig();
  const res = await fetch(`${CF_API}/accounts/${cf.accountId}/stream/direct_upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cf.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      maxDurationSeconds: opts.maxDurationSeconds ?? 3600,
      creator: opts.creator,
      meta: { name: opts.name ?? "cut" },
      requireSignedURLs: false,
      allowedOrigins: ["*"],
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(`Cloudflare direct_upload failed: ${JSON.stringify(json.errors ?? json)}`);
  }
  return { uploadURL: json.result.uploadURL, uid: json.result.uid };
}

export interface StreamVideoState {
  uid: string;
  status: "uploading" | "processing" | "ready" | "errored";
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  playbackUrl: string | null;
}

export async function getStreamVideo(uid: string): Promise<StreamVideoState> {
  const cf = await cfConfig();
  const res = await fetch(`${CF_API}/accounts/${cf.accountId}/stream/${uid}`, {
    headers: { Authorization: `Bearer ${cf.token}` },
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    return { uid, status: "errored", durationSeconds: null, thumbnailUrl: null, playbackUrl: null };
  }
  const r = json.result;
  const state = r.readyToStream
    ? "ready"
    : r.status?.state === "error"
      ? "errored"
      : r.status?.state === "inprogress" || r.status?.state === "queued"
        ? "processing"
        : "uploading";
  return {
    uid,
    status: state,
    durationSeconds: typeof r.duration === "number" && r.duration > 0 ? r.duration : null,
    thumbnailUrl: r.thumbnail ?? null,
    playbackUrl: `https://customer-${cf.customerCode}.cloudflarestream.com/${uid}/manifest/video.m3u8`,
  };
}

/**
 * An MP4 download link for a Stream video. Cloudflare builds the file after
 * downloads are switched on, so the first response has a URL that isn't ready
 * yet — Instagram or Drive fetching it at that moment would get an error. So
 * this waits (up to about 90 seconds) for the file to report ready.
 */
export async function getDownloadUrl(uid: string): Promise<string | null> {
  const cf = await cfConfig();
  const endpoint = `${CF_API}/accounts/${cf.accountId}/stream/${uid}/downloads`;
  const headers = { Authorization: `Bearer ${cf.token}` };

  let res = await fetch(endpoint, { method: "POST", headers });
  let json = await res.json();
  if (!res.ok || !json.success) return null;

  for (let i = 0; i < 18; i++) {
    const d = json.result?.default;
    if (d?.url && (d.status === "ready" || d.percentComplete === 100)) return d.url as string;
    if (d?.status === "error") return null;
    await new Promise((r) => setTimeout(r, 5000));
    res = await fetch(endpoint, { headers });
    json = await res.json();
    if (!res.ok || !json.success) return null;
  }
  // Still building after the wait — hand back the URL anyway; the caller's
  // own fetch will say if it isn't there.
  return (json.result?.default?.url as string | undefined) ?? null;
}

export async function deleteStreamVideo(uid: string): Promise<void> {
  const cf = await cfConfig();
  await fetch(`${CF_API}/accounts/${cf.accountId}/stream/${uid}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${cf.token}` },
  }).catch(() => {});
}
