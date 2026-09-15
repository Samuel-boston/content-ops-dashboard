import { requireUser } from "@/lib/auth";
import { libraryFacets, searchLibraryShots } from "@/app/library-visuals-actions";
import { VisualsBrowser } from "@/components/library/VisualsBrowser";

/**
 * The footage index — every analysed shot from the client's archive (synced
 * up from the B-Roll Librarian), searchable by what's actually IN the frame:
 * "adam journaling calm morning" finds the shot, not the filename. The
 * B-roll folders tab is the map of the Drive; this is the shot-level catalog.
 */
export default async function VisualsPage({
  searchParams,
}: PageProps<"/library/visuals">) {
  await requireUser();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const media = params.media === "video" || params.media === "image" ? params.media : "";
  const emotion = typeof params.emotion === "string" ? params.emotion : "";
  const topPicks = params.top === "1";

  const [shots, facets] = await Promise.all([
    searchLibraryShots({ q, media, emotion, topPicks }),
    libraryFacets(),
  ]);

  return (
    <VisualsBrowser
      shots={shots}
      facets={facets}
      initial={{ q, media, emotion, topPicks }}
    />
  );
}
