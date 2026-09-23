"use client";

import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { IconTrash } from "@/components/ui/icons";
import { deleteAssetAction } from "@/app/asset-actions";
import type { VideoAsset } from "@/lib/types";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|heic|bmp|svg)$/i;
const VIDEO_EXT = /\.(mp4|mov|webm|m4v|mkv)$/i;

/** What a supporting file is, from its name — the asset row doesn't store a mime type. */
export function assetMediaKind(a: Pick<VideoAsset, "label" | "storage_path" | "external_url">): "image" | "video" | "file" {
  const names = [a.label, a.storage_path ?? "", a.external_url ?? ""];
  if (names.some((n) => IMAGE_EXT.test(n))) return "image";
  if (names.some((n) => VIDEO_EXT.test(n))) return "video";
  // Screen recordings are labelled, not named — they're always video.
  if (/screen recording/i.test(a.label)) return "video";
  return "file";
}

/**
 * The screenshots, clips and screen recordings attached to a brief — shown as
 * what they are (an image is an image, not a greyed-out player). These are
 * part of the brief, so they live here rather than in the raw-footage list.
 */
export function BriefAttachments({
  videoId,
  assets,
  canEdit = false,
}: {
  videoId: string;
  assets: VideoAsset[];
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTrackedTransition();
  const items = assets.filter((a) => a.kind === "other");
  if (items.length === 0) return null;

  return (
    <ul className="space-y-2">
      {items.map((c) => {
        const kind = assetMediaKind(c);
        const url = c.signed_url ?? c.external_url ?? c.drive_url ?? null;
        return (
          <li key={c.id} className="rounded-lg border border-line bg-panel p-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-ink-2">{c.label}</span>
              {url && kind === "file" ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-xs text-accent-hi hover:underline"
                >
                  Open
                </a>
              ) : null}
              {canEdit ? (
                <button
                  type="button"
                  onClick={() =>
                    startTransition(async () => {
                      await deleteAssetAction(c.id, videoId);
                      router.refresh();
                    })
                  }
                  className="shrink-0 text-ink-3 hover:text-danger"
                  aria-label="Remove"
                >
                  <IconTrash size={12} />
                </button>
              ) : null}
            </div>
            {url && kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={c.label} className="mt-1.5 max-h-64 w-full rounded-md bg-black/20 object-contain" />
            ) : null}
            {url && kind === "video" ? (
              <video src={url} controls className="mt-1.5 max-h-64 w-full rounded-md bg-black" />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
