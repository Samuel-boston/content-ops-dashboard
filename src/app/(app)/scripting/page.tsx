import { requireRole } from "@/lib/auth";
import { listEditors, listTaxonomyCustoms } from "@/app/actions";
import { listBoardCards } from "@/app/board-actions";
import { listSeriesOptions } from "@/app/series-actions";
import { BoardPageClient } from "@/components/board/BoardPageClient";

/**
 * The planning board — Ideation through Ready to Film in one place, for the
 * copywriter's desk and (as the same Scripting tab) the client's board.
 *
 * It replaces separate Ideation / Scripting / Script Review lists: a video's
 * whole life on the writing side is one row of columns, and dragging a card
 * is the way it moves. The database still decides who may make which move —
 * a copywriter can go up to Script Review and back, but only the client can
 * approve a script for filming.
 */
export default async function ScriptingPage() {
  const viewer = await requireRole("owner", "admin", "copywriter");
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
        // Assigning editors is the client's call — an empty list hides that control.
        editors={
          viewer.role === "copywriter"
            ? []
            : editors.map((e) => ({ id: e.id, full_name: e.full_name, email: e.email }))
        }
        customs={customsBy}
        seriesOptions={seriesOptions}
        viewerId={viewer.id}
        scopes={["scripting"]}
        basePath="/scripting"
      />
    </div>
  );
}
