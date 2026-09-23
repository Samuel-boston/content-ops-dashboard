"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { deleteAssetAction, registerAssetAction } from "@/app/asset-actions";
import type { VideoAsset } from "@/lib/types";

/**
 * Finished-video links — the alternative to uploading the cut. An editor who
 * already has the export on Drive or Frame.io can paste one link or several
 * (a 16:9 and a 9:16, say) instead of re-uploading. `canEdit` off makes it a
 * read-only list for the client.
 */
export function FinishedLinks({
  videoId,
  assets,
  canEdit,
}: {
  videoId: string;
  assets: VideoAsset[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTrackedTransition();
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const links = assets.filter((a) => a.kind === "delivery");

  if (!canEdit && links.length === 0) return null;

  function add() {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!/^https?:\/\//i.test(trimmed)) {
      toast.error("Paste a full link starting with https://");
      return;
    }
    startTransition(async () => {
      const r = await registerAssetAction({
        videoId,
        kind: "delivery",
        label,
        externalUrl: trimmed,
      });
      if (toast.result(r, "Link added")) {
        setUrl("");
        setLabel("");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-2">
      {links.length > 0 ? (
        <ul className="space-y-1.5">
          {links.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded-lg bg-card px-2.5 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">{a.label}</span>
              <a
                href={a.external_url ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-xs text-accent-hi hover:underline"
              >
                Open
              </a>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() =>
                    startTransition(async () => {
                      await deleteAssetAction(a.id, videoId);
                      router.refresh();
                    })
                  }
                  className="shrink-0 text-ink-3 hover:text-danger"
                  aria-label="Remove link"
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Name (optional) — e.g. 9:16 export"
            className="w-44 min-w-0 rounded-md bg-raised px-2 py-1.5 text-xs placeholder:text-ink-3 focus:outline-none"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="…or paste a link to the finished video"
            className="min-w-[200px] flex-1 rounded-md bg-raised px-2 py-1.5 text-xs placeholder:text-ink-3 focus:outline-none"
          />
          <button
            type="button"
            onClick={add}
            disabled={!url.trim()}
            className="rounded-md bg-hover px-3 py-1.5 text-xs hover:bg-line-strong disabled:opacity-50"
          >
            Add link
          </button>
        </div>
      ) : null}
    </div>
  );
}
