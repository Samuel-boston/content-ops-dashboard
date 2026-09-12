"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BoardShell } from "@/components/board/BoardShell";
import { NewVideoDialog } from "@/components/CreateVideoButton";
import { VideoQuickView } from "@/components/board/VideoQuickView";
import type { BoardCard, Profile, Series } from "@/lib/types";

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const openId = searchParams.get("open");

  function closeQuickView() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("open");
    const qs = next.toString();
    router.replace(qs ? `/board?${qs}` : "/board", { scroll: false });
  }

  return (
    <>
      <BoardShell
        cards={cards}
        editors={editors}
        headline="Active pipeline"
        onNew={() => setCreating(true)}
      />
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
    </>
  );
}
