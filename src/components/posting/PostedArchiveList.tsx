"use client";

import { useState } from "react";
import type { PostedVideoRow } from "@/app/posting-actions";
import { PostedVideoDialog } from "@/components/posting/PostingDialogs";

/** Every posted video that went through the VA: search it, open one for performance and to post the best trial to the feed. */
export function PostedArchiveList({ rows, clientName, query }: { rows: PostedVideoRow[]; clientName: string; query: string }) {
  const [open, setOpen] = useState<{ id: string; title: string } | null>(null);
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => !q || r.title.toLowerCase().includes(q));
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-ink-3">
        Everything that&rsquo;s been posted. Open a video to add performance, see which trial is winning, and post it to the main feed.
      </p>
      {shown.length === 0 ? (
        <p className="rounded-xl border border-line bg-card px-4 py-8 text-center text-sm text-ink-3">Nothing in the archive yet.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-card">
          {shown.map((r) => (
            <button
              key={r.videoId}
              type="button"
              onClick={() => setOpen({ id: r.videoId, title: r.title })}
              className="flex w-full flex-wrap items-center gap-3 border-b border-line px-4 py-2.5 text-left last:border-0 hover:bg-hover"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.title}</span>
              <span className="text-[11px] text-ink-3">
                {r.variants} variant{r.variants === 1 ? "" : "s"}
                {r.trialsLive ? ` · ${r.trialsLive} trial` : ""}
                {r.onFeed ? ` · ${r.onFeed} on feed` : ""}
              </span>
              {r.best ? <span className="text-[11px] text-ink-2">🏆 {r.best.label} · {r.best.views.toLocaleString()} views</span> : null}
              <span className="text-[11px] text-ink-3">
                {r.postedAt ? new Date(r.postedAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : ""}
              </span>
            </button>
          ))}
        </div>
      )}
      {open ? <PostedVideoDialog videoId={open.id} title={open.title} clientName={clientName} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/** The VA's own Archive page: the list above with its own search box. */
export function VaArchive({ rows, clientName }: { rows: PostedVideoRow[]; clientName: string }) {
  const [query, setQuery] = useState("");
  return (
    <div className="space-y-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search posted videos…"
        className="w-full max-w-xs rounded-md border border-line bg-raised px-2 py-1.5 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
      />
      <PostedArchiveList rows={rows} clientName={clientName} query={query} />
    </div>
  );
}
