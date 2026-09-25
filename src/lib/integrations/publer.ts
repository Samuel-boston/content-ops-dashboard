import "server-only";
import { getWorkspaceSettings, publerAccounts } from "@/lib/workspace";
import { NotConfiguredError } from "@/lib/integrations/stream";
import {
  DIRECT_UPLOAD_LIMIT_BYTES,
  importMediaFromUrl,
  publishVideo,
  type VideoNetwork,
  uploadMedia,
  PublerError,
  type PublerCreds,
} from "@/lib/publer-client";

/** Saved Publer settings, or null when Publer isn't connected. */
export async function publerSettings() {
  const s = await getWorkspaceSettings();
  if (!s.publer_api_key || !s.publer_workspace_id) return null;
  const accounts = publerAccounts(s);
  if (!Object.keys(accounts).length) return null;
  return {
    creds: { apiKey: s.publer_api_key, workspaceId: s.publer_workspace_id } satisfies PublerCreds,
    accounts,
    trialMode: s.publer_trial_mode ?? "MANUAL",
  };
}

/**
 * Post one video through Publer to one or more networks (Instagram as a Reel or
 * trial reel, YouTube as a Short, TikTok, LinkedIn).
 *
 * `videoUrl` is any address Publer and this server can both fetch. The bytes are
 * uploaded to Publer once, directly when they fit its 200 MB limit; a bigger cut
 * is handed to Publer as a link to import itself. Every network then posts the
 * same uploaded media. A network with no Publer account chosen is an error, not
 * a silent skip. Returns Publer's job ids, comma-joined.
 */
export async function postVideoViaPubler(input: {
  videoUrl: string;
  filename?: string;
  caption: string;
  title?: string;
  /** YouTube: a Short (default) or a regular long video. */
  youtubeKind?: "short" | "video";
  networks: VideoNetwork[];
  asTrial: boolean;
  shareToFeed?: boolean;
  scheduledAt?: string;
  /** Called as soon as a network has taken the post, so a later failure can be told apart from what already went out. */
  onPosted?: (network: VideoNetwork, jobId: string, unconfirmed: boolean) => Promise<void>;
}): Promise<{ jobId: string }> {
  const p = await publerSettings();
  if (!p) throw new NotConfiguredError("Publer");
  const missing = input.networks.filter((n) => !p.accounts[n]);
  if (missing.length) {
    throw new PublerError(`No ${missing.join(" or ")} account is connected in Publer. Connect it in Settings → Publer.`);
  }
  const name = input.filename ?? "cut.mp4";

  const res = await fetch(input.videoUrl);
  if (!res.ok || !res.body) throw new PublerError(`The video couldn't be fetched to send to Publer (${res.status}).`);
  const type = res.headers.get("content-type") ?? "";
  if (/^text\/|html/i.test(type)) {
    await res.body.cancel();
    throw new PublerError("The link for this video gave a web page, not the video file. Re-upload the cut so a real file is available.");
  }
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

  const ids: string[] = [];
  for (const network of input.networks) {
    const sent = await publishVideo(p.creds, {
      network,
      accountId: p.accounts[network].id,
      media,
      caption: input.caption,
      title: input.title,
      youtubeKind: input.youtubeKind,
      trial: network === "instagram" && input.asTrial ? p.trialMode : undefined,
      shareToFeed: input.shareToFeed,
      scheduledAt: input.scheduledAt,
    });
    ids.push(sent.jobId);
    await input.onPosted?.(network, sent.jobId, Boolean(sent.unconfirmed));
  }
  return { jobId: ids.join(",") };
}
