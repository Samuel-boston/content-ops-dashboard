import "server-only";
import { getWorkspaceSettings } from "@/lib/workspace";
import { NotConfiguredError } from "@/lib/integrations/stream";
import {
  DIRECT_UPLOAD_LIMIT_BYTES,
  importMediaFromUrl,
  publishReel,
  uploadMedia,
  PublerError,
  type PublerCreds,
} from "@/lib/publer-client";

/** Saved Publer settings, or null when Publer isn't connected. */
export async function publerSettings() {
  const s = await getWorkspaceSettings();
  if (!s.publer_api_key || !s.publer_workspace_id || !s.publer_account_id) return null;
  return {
    creds: { apiKey: s.publer_api_key, workspaceId: s.publer_workspace_id } satisfies PublerCreds,
    accountId: s.publer_account_id,
    accountName: s.publer_account_name,
    trialMode: s.publer_trial_mode ?? "MANUAL",
  };
}

/**
 * Post one video to Instagram as a Reel (or trial reel) through Publer.
 *
 * `videoUrl` is any address Publer and this server can both fetch. The bytes are
 * uploaded to Publer directly when they fit its 200 MB limit; a bigger cut is
 * handed to Publer as a link to import itself.
 */
export async function postReelViaPubler(input: {
  videoUrl: string;
  filename?: string;
  caption: string;
  asTrial: boolean;
  shareToFeed?: boolean;
  scheduledAt?: string;
}): Promise<{ jobId: string }> {
  const p = await publerSettings();
  if (!p) throw new NotConfiguredError("Publer");
  const name = input.filename ?? "cut.mp4";

  const res = await fetch(input.videoUrl);
  if (!res.ok || !res.body) throw new PublerError(`The video couldn't be fetched to send to Publer (${res.status}).`);
  const size = Number(res.headers.get("content-length") ?? 0);

  let media;
  if (size && size > DIRECT_UPLOAD_LIMIT_BYTES) {
    await res.body.cancel();
    media = await importMediaFromUrl(p.creds, input.videoUrl, name);
  } else {
    const blob = await res.blob();
    media =
      blob.size > DIRECT_UPLOAD_LIMIT_BYTES
        ? await importMediaFromUrl(p.creds, input.videoUrl, name)
        : await uploadMedia(p.creds, new Blob([blob], { type: "video/mp4" }), name);
  }

  return publishReel(p.creds, {
    accountId: p.accountId,
    media,
    caption: input.caption,
    trial: input.asTrial ? p.trialMode : undefined,
    shareToFeed: input.shareToFeed,
    scheduledAt: input.scheduledAt,
  });
}
