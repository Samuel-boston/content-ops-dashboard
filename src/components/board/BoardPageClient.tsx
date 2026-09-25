"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BoardShell } from "@/components/board/BoardShell";
import { NewVideoDialog } from "@/components/CreateVideoButton";
import { VideoQuickView } from "@/components/board/VideoQuickView";
import { isCarouselFormat, isLongFormFormat } from "@/lib/taxonomy";
import type { BoardCard, Profile, Series, VideoStatus } from "@/lib/types";

export type BoardScope = "all" | "videos" | "carousels" | "filming" | "longform" | "planning";

/**
 * The default view is everything at once — videos and carousels side by side
 * in one board, scripting included. The other tabs narrow it: a carousel's much
 * shorter life (no filming, no raw footage), just the handoff between "filmed"
 * and "with the editors", or the long-form (YouTube) videos on their own. The
 * copywriter only ever gets Planning: ideas in, scripts out.
 */
const SCOPES: Record<
  BoardScope,
  { label: string; columns: VideoStatus[]; match: (c: BoardCard) => boolean }
> = {
  all: {
    label: "All Content",
    columns: [
      "ideation",
      "scripting",
      "needs_creatives",
      "ready_to_film",
      "ready_to_edit",
      "in_progress",
      "in_review",
      "revisions",
      "awaiting_variants",
      "final_review",
      "with_va",
    ],
    match: () => true,
  },
  videos: {
    label: "Videos",
    columns: [
      "ideation",
      "scripting",
      "ready_to_film",
      "ready_to_edit",
      "in_progress",
      "in_review",
      "revisions",
      "awaiting_variants",
      "final_review",
      "with_va",
    ],
    match: (c) => !isCarouselFormat(c.formats),
  },
  carousels: {
    label: "Carousels",
    // The images get made outside this dashboard (on the platform itself, no
    // editor involved), reviewed here, and go straight to the VA. No Editor
    // Brief, Ready to Edit, Editing, In Review, Revisions or Final Review.
    columns: ["ideation", "scripting", "needs_creatives", "with_va"],
    match: (c) => isCarouselFormat(c.formats),
  },
  longform: {
    label: "Long-form",
    // YouTube videos: the full video pipeline, posted to YouTube as a regular video.
    columns: [
      "ideation",
      "scripting",
      "ready_to_film",
      "ready_to_edit",
      "in_progress",
      "in_review",
      "revisions",
      "awaiting_variants",
      "final_review",
      "with_va",
    ],
    match: (c) => isLongFormFormat(c.formats),
  },
  filming: {
    label: "Filming",
    columns: ["ready_to_film", "ready_to_edit"],
    match: (c) => !isCarouselFormat(c.formats),
  },
  planning: {
    label: "Planning",
    columns: ["ideation", "scripting", "ready_to_film"],
    match: () => true,
  },
};
const SCOPE_ORDER: BoardScope[] = ["all", "carousels", "filming", "longform"];

/** Thin client wrapper so the board's "New video" button can open the dialog. */
export function BoardPageClient({
  cards,
  editors,
  customs,
  seriesOptions,
  viewerId,
  scopes = SCOPE_ORDER,
  basePath = "/board",
  extraActions,
}: {
  cards: BoardCard[];
  editors: Pick<Profile, "id" | "full_name" | "email">[];
  customs: { content_pillar: string[]; format: string[]; platform: string[] };
  seriesOptions: Series[];
  viewerId: string;
  /** Which scope tabs to offer — the copywriter only ever gets Planning. */
  scopes?: BoardScope[];
  /** The route this board lives on, so closing the quick view stays put. */
  basePath?: string;
  /** Extra controls on the right of the tab row (idea tools, for the copywriter). */
  extraActions?: React.ReactNode;
}) {
  const [creating, setCreating] = useState(false);
  const [scope, setScope] = useState<BoardScope>(scopes[0]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const openId = searchParams.get("open");

  const active = SCOPES[scope];
  const scoped = useMemo(() => cards.filter(active.match), [cards, active]);

  function closeQuickView() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("open");
    const qs = next.toString();
    router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
        {scopes.length > 1 ? (
          <div className="flex w-fit items-center gap-0.5 rounded-lg border border-line bg-card p-0.5">
            {scopes.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                aria-pressed={scope === s}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  scope === s ? "bg-accent text-white" : "text-ink-2 hover:bg-hover hover:text-ink"
                }`}
              >
                {SCOPES[s].label}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        {extraActions ? <div className="flex items-center gap-2">{extraActions}</div> : null}
      </div>
      <div className="min-h-0 flex-1">
        <BoardShell
          key={scope}
          cards={scoped}
          columns={active.columns}
          editors={editors}
          headline={`Active pipeline — ${active.label}`}
          onNew={() => setCreating(true)}
        />
      </div>
      <NewVideoDialog
        open={creating}
        onClose={() => setCreating(false)}
        editors={editors}
        customs={customs}
        viewerId={viewerId}
      />
      {openId ? (
        <VideoQuickView
          key={openId}
          videoId={openId}
          customs={customs}
          seriesOptions={seriesOptions}
          onClose={closeQuickView}
        />
      ) : null}
    </div>
  );
}
