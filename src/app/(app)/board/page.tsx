import { requireRole } from "@/lib/auth";
import { listEditors, listTaxonomyCustoms } from "@/app/actions";
import { listBoardCards } from "@/app/board-actions";
import { listSeriesOptions } from "@/app/series-actions";
import { BoardPageClient } from "@/components/board/BoardPageClient";

export default async function BoardPage() {
  const viewer = await requireRole("owner", "admin");
  const [cards, editors, customs, seriesOptions] = await Promise.all([
    listBoardCards(),
    listEditors(),
    listTaxonomyCustoms(),
    listSeriesOptions(),
  ]);

  const customsBy = {
    content_pillar: customs.filter((c) => c.kind === "content_pillar").map((c) => c.value),
    format: customs.filter((c) => c.kind === "format").map((c) => c.value),
    platform: customs.filter((c) => c.kind === "platform").map((c) => c.value),
  };

  return (
    <div className="h-[calc(100dvh-7rem)]">
      <BoardPageClient
        cards={cards}
        editors={editors.map((e) => ({ id: e.id, full_name: e.full_name, email: e.email }))}
        customs={customsBy}
        seriesOptions={seriesOptions}
        viewerId={viewer.id}
      />
    </div>
  );
}
