"use client";

import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import {
  cancelPublishJobAction,
  createPublishJobAction,
  publishNowAction,
} from "@/app/publishing-actions";
import type { PublishJob, VideoWithEditor } from "@/lib/types";

const STATUS_STYLES: Record<string, string> = {
  scheduled: "text-warn",
  publishing: "text-blue-300",
  published: "text-ok",
  failed: "text-danger",
  cancelled: "text-ink-3",
};

export function PublishingBoard({
  jobs,
  candidates,
}: {
  jobs: PublishJob[];
  candidates: VideoWithEditor[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();
  const [err, setErr] = useState<string | null>(null);
  const byId = new Map(candidates.map((v) => [v.id, v]));

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="rounded-xl border border-line bg-app overflow-hidden">
        <div className="border-b border-line px-4 py-2.5 text-sm font-semibold">Queue</div>
        {jobs.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-3">Nothing queued.</p>
        ) : (
          jobs.map((j) => (
            <div key={j.id} className="border-b border-line px-4 py-3 last:border-0">
              <div className="flex items-center gap-2">
                <span className="flex-1 font-medium">{byId.get(j.video_id)?.title ?? "Video"}</span>
                <span className={`text-xs capitalize ${STATUS_STYLES[j.status] ?? ""}`}>{j.status}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-ink-3">
                <span>
                  {j.scheduled_for
                    ? `Scheduled ${new Date(j.scheduled_for).toLocaleString()}`
                    : "Manual"}
                </span>
                {j.error ? <span className="text-danger">{j.error}</span> : null}
                {j.ig_media_id ? <span className="text-ok">media {j.ig_media_id}</span> : null}
                {j.status === "scheduled" || j.status === "failed" ? (
                  <>
                    <button
                      onClick={() =>
                        startTransition(async () => {
                          setErr(null);
                          const r = await publishNowAction(j.id);
                          if (r?.error) setErr(r.error);
                          router.refresh();
                        })
                      }
                      className="text-accent-hi hover:underline"
                    >
                      Publish now
                    </button>
                    <button
                      onClick={() => cancelPublishJobAction(j.id).then(() => router.refresh())}
                      className="hover:text-danger"
                    >
                      Cancel
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))
        )}
        {err ? <p className="px-4 py-2 text-xs text-danger">{err}</p> : null}
      </div>

      <form
        action={async (fd) => {
          const r = await createPublishJobAction(fd);
          if (r?.error) setErr(r.error);
          else router.refresh();
        }}
        className="h-fit space-y-3 rounded-xl border border-line bg-app p-4"
      >
        <h2 className="text-sm font-semibold">Schedule a post</h2>
        <div>
          <label className="mb-1 block text-xs text-ink-2">Video (approved)</label>
          <select
            name="video_id"
            required
            disabled={pending}
            className="w-full rounded-lg bg-raised border border-line-strong px-2 py-2 text-sm outline-none"
          >
            <option value="">Pick a video…</option>
            {candidates
              .filter((v) => v.status === "approved")
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-2">Caption</label>
          <textarea
            name="caption"
            rows={3}
            className="w-full rounded-lg bg-raised border border-line-strong px-2 py-1.5 text-sm outline-none resize-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-ink-2">
            When <span className="text-ink-3">(blank = manual)</span>
          </label>
          <input
            type="datetime-local"
            name="scheduled_for"
            className="w-full rounded-lg bg-raised border border-line-strong px-2 py-1.5 text-sm outline-none"
          />
        </div>
        <button className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hi">
          Add to queue
        </button>
      </form>
    </div>
  );
}
