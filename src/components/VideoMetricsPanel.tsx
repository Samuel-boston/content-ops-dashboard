"use client";

import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { linkInstagramMediaAction } from "@/app/analytics-actions";
import type { VideoMetrics } from "@/lib/types";

const STATS: { key: keyof VideoMetrics; label: string }[] = [
  { key: "views", label: "Views" },
  { key: "reach", label: "Reach" },
  { key: "likes", label: "Likes" },
  { key: "comments", label: "Comments" },
  { key: "shares", label: "Shares" },
  { key: "saves", label: "Saves" },
];

export function VideoMetricsPanel({
  videoId,
  metrics,
  canManage,
  instagramConfigured,
}: {
  videoId: string;
  metrics: VideoMetrics | null;
  canManage: boolean;
  instagramConfigured: boolean;
}) {
  const router = useRouter();
  const [mediaId, setMediaId] = useState(metrics?.external_media_id ?? "");
  const [pending, startTransition] = useTrackedTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-line bg-app p-4">
      <h3 className="mb-3 text-sm font-semibold text-ink-2">Performance</h3>
      {metrics ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            {STATS.map((s) => (
              <div key={s.key} className="rounded-md border border-line bg-card px-2 py-1.5">
                <div className="font-mono text-base font-semibold tabular-nums">
                  {(metrics[s.key] as number | null) ?? "—"}
                </div>
                <div className="text-[10px] text-ink-3">{s.label}</div>
              </div>
            ))}
          </div>
          {metrics.permalink ? (
            <a
              href={metrics.permalink}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-xs text-accent-hi hover:underline"
            >
              View on Instagram →
            </a>
          ) : null}
          <p className="mt-2 text-[10px] text-ink-3">
            Updated {new Date(metrics.fetched_at).toLocaleString()}
          </p>
        </>
      ) : (
        <p className="text-xs text-ink-3">
          No numbers yet.{" "}
          {instagramConfigured
            ? "Link this video to its Instagram post below."
            : "Connect Instagram in Settings → Integrations to pull metrics automatically."}
        </p>
      )}

      {canManage && instagramConfigured ? (
        <div className="mt-3 flex gap-2">
          <input
            value={mediaId}
            onChange={(e) => setMediaId(e.target.value)}
            placeholder="Instagram media ID"
            className="flex-1 rounded bg-raised px-2 py-1 text-xs outline-none"
          />
          <button
            disabled={pending || !mediaId.trim()}
            onClick={() =>
              startTransition(async () => {
                setErr(null);
                const r = await linkInstagramMediaAction(videoId, mediaId.trim());
                if (r?.error) setErr(r.error);
                else router.refresh();
              })
            }
            className="rounded bg-hover px-2 py-1 text-xs hover:bg-line-strong disabled:opacity-50"
          >
            {pending ? "…" : "Link & pull"}
          </button>
        </div>
      ) : null}
      {err ? <p className="mt-1 text-[11px] text-danger">{err}</p> : null}
    </div>
  );
}
