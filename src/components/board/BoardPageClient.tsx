"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BoardShell } from "@/components/board/BoardShell";
import { NewVideoDialog } from "@/components/CreateVideoButton";
import { VideoQuickView } from "@/components/board/VideoQuickView";
import { isCarouselFormat } from "@/lib/taxonomy";
import type { BoardCard, Profile, Series, VideoStatus } from "@/lib/types";

type BoardScope = "videos" | "carousels" | "scripting" | "filming";

/**
 * One continuous 12-column board reads as "everything, always" — nothing
 * ever looks finished or separated. These four scopes split it the way the
 * work actually splits: a video's post-production, a carousel's much
 * shorter life (no filming, no raw footage), the planning half both
 * copywriter and client watch, and the handoff between "filmed" and "with
 * the editors". Ready to Edit deliberately appears in both Filming and
 * Videos — it's the same handoff, viewed from either side of it.
 */
const SCOPES: Record<
  BoardScope,
  { label: string; columns: VideoStatus[]; match: (c: BoardCard) => boolean }
> = {
  videos: {
    label: "Videos",
    columns: [
      "ready_to_edit",
      "in_progress",
      "in_review",
      "revisions",
      "awaiting_variants",
      "final_review",
      "ready_to_post",
    ],
    match: (c) => !isCarouselFormat(c.formats),
  },
  carousels: {
    label: "Carousels",
    // A carousel never gets filmed, briefed, or handed to an editor — once
    // Script Review is approved the deliverable already exists, so it lands
    // straight on Ready to Post. No Editor Brief, Ready to Edit, Editing,
    // In Review, Revisions or Final Review in between.
    columns: ["ideation", "scripting", "script_review", "ready_to_post"],
    match: (c) => isCarouselFormat(c.formats),
  },
  scripting: {
    label: "Scripting",
    columns: ["ideation", "scripting", "script_review"],
    match: () => true,
  },
  filming: {
    label: "Filming",
    columns: ["ready_to_film", "editor_brief", "ready_to_edit"],
    match: (c) => !isCarouselFormat(c.formats),
  },
};
const SCOPE_ORDER: BoardScope[] = ["videos", "carousels", "scripting", "filming"];

/** Thin client wrapper so the board's "New video" button can open the dialog. */
export function BoardPageClient({
  cards,
  editors,
  customs,
  seriesOptions,
  viewerId,
}: {
  cards: BoardCard[];
  editors: Pick<Profile, "id" | "full_name" | "email">[];
  customs: { content_pillar: string[]; format: string[]; platform: string[] };
  seriesOptions: Series[];
  viewerId: string;
}) {
  const [creating, setCreating] = useState(false);
  const [scope, setScope] = useState<BoardScope>("videos");
  const router = useRouter();
  const searchParams = useSearchParams();
  const openId = searchParams.get("open");

  const active = SCOPES[scope];
  const scoped = useMemo(() => cards.filter(active.match), [cards, active]);

  function closeQuickView() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("open");
    const qs = next.toString();
    router.replace(qs ? `/board?${qs}` : "/board", { scroll: false });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex w-fit shrink-0 items-center gap-0.5 rounded-lg border border-line bg-card p-0.5">
        {SCOPE_ORDER.map((s) => (
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
