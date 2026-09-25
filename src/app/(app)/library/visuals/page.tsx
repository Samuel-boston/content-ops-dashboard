import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { libraryFacets, libraryTree, searchLibraryShots } from "@/app/library-visuals-actions";
import { NO_CATEGORY, folderName } from "@/lib/broll";
import { VisualsBrowser, ShotCard } from "@/components/library/VisualsBrowser";
import { BrollSuggester } from "@/components/library/BrollSuggester";

type View = "browse" | "search" | "suggest";

const VIEWS: { id: View; label: string; hint: string }[] = [
  { id: "browse", label: "Browse", hint: "By folder" },
  { id: "search", label: "Search", hint: "By what's in the shot" },
  { id: "suggest", label: "Suggest for a script", hint: "Clips for each line" },
];

/**
 * The B-roll section. One place for everything about the footage archive: browse it by the folders
 * the librarian sorted it into, search what's actually in the frame, or paste a script and get
 * clips for each line. The librarian itself only uploads, analyses and sorts; what it finds is
 * synced up here, so the whole team works from the same index.
 */
export default async function VisualsPage({ searchParams }: PageProps<"/library/visuals">) {
  await requireUser();
  const params = await searchParams;
  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const q = str("q");
  const view: View = str("view") === "search" || str("view") === "suggest" || str("view") === "browse" ? (str("view") as View) : q ? "search" : "browse";

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-2" aria-label="B-roll views">
        {VIEWS.map((v) => (
          <Link
            key={v.id}
            href={`/library/visuals?view=${v.id}`}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              view === v.id ? "border-accent bg-accent/10 text-ink" : "border-line text-ink-2 hover:border-accent hover:text-ink"
            }`}
          >
            {v.label}
            <span className="ml-2 hidden text-[11px] text-ink-3 sm:inline">{v.hint}</span>
          </Link>
        ))}
      </nav>

      {view === "search" ? <SearchView params={{ q, media: str("media"), emotion: str("emotion"), top: str("top") }} /> : null}
      {view === "browse" ? <BrowseView cat={str("cat")} more={str("more") === "1"} /> : null}
      {view === "suggest" ? <BrollSuggester /> : null}
    </div>
  );
}

async function SearchView({ params }: { params: { q: string; media: string; emotion: string; top: string } }) {
  const media = params.media === "video" || params.media === "image" ? params.media : "";
  const topPicks = params.top === "1";
  const [shots, facets] = await Promise.all([
    searchLibraryShots({ q: params.q, media, emotion: params.emotion, topPicks }),
    libraryFacets(),
  ]);
  return <VisualsBrowser shots={shots} facets={facets} initial={{ q: params.q, media, emotion: params.emotion, topPicks }} />;
}

async function BrowseView({ cat, more }: { cat: string; more: boolean }) {
  const tree = await libraryTree();
  if (tree.total === 0) {
    return (
      <div className="rounded-xl border border-line bg-card px-4 py-14 text-center text-sm text-ink-3">
        Nothing synced yet. Once the B-Roll Librarian has indexed footage and been connected to this dashboard, every clip lands here, sorted into its
        folders.
      </div>
    );
  }
  const shots = cat
    ? await searchLibraryShots({ category: cat, limit: more ? 96 : 48 })
    : [];
  const link = (c: string, extra = "") => `/library/visuals?view=browse${c ? `&cat=${encodeURIComponent(c)}` : ""}${extra}`;
  const heading = !cat ? "" : cat === NO_CATEGORY ? "Uncategorised" : cat.split("/").map(folderName).join(" / ");

  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      <aside className="space-y-1 md:sticky md:top-4 md:self-start">
        <Link href={link("")} className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm ${!cat ? "bg-raised text-ink" : "text-ink-2 hover:bg-hover"}`}>
          <span>All folders</span>
          <span className="text-[11px] text-ink-3">{tree.total}</span>
        </Link>
        {tree.sections.map((sec) => {
          const open = cat === sec.key || cat.startsWith(`${sec.key}/`);
          return (
            <details key={sec.key} open={open} className="rounded-lg">
              <summary
                className={`flex cursor-pointer list-none items-center justify-between rounded-lg px-2.5 py-1.5 text-sm ${
                  cat === sec.key ? "bg-raised text-ink" : "text-ink-2 hover:bg-hover"
                }`}
              >
                <Link href={link(sec.key)} className="flex-1 truncate">
                  {sec.name}
                </Link>
                <span className="ml-2 text-[11px] text-ink-3">{sec.count}</span>
              </summary>
              <ul className="ml-3 border-l border-line pl-2">
                {sec.subs.map((sub) => (
                  <li key={sub.key}>
                    <Link
                      href={link(sub.key)}
                      className={`flex items-center justify-between rounded-md px-2 py-1 text-xs ${cat === sub.key ? "bg-raised text-ink" : "text-ink-2 hover:bg-hover"}`}
                    >
                      <span className="truncate">{sub.name}</span>
                      <span className="ml-2 text-[11px] text-ink-3">{sub.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
        {tree.uncategorised > 0 ? (
          <Link href={link(NO_CATEGORY)} className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm ${cat === NO_CATEGORY ? "bg-raised text-ink" : "text-ink-3 hover:bg-hover"}`}>
            <span>Uncategorised</span>
            <span className="text-[11px]">{tree.uncategorised}</span>
          </Link>
        ) : null}
      </aside>

      <section className="min-w-0 space-y-3">
        {!cat ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {tree.sections.map((sec) => (
              <Link key={sec.key} href={link(sec.key)} className="rounded-xl border border-line bg-card p-4 hover:border-accent">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold">{sec.name}</h2>
                  <span className="text-xs text-ink-3">{sec.count} shots</span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-xs text-ink-3">{sec.subs.slice(0, 6).map((s) => s.name).join(" · ")}</p>
              </Link>
            ))}
          </div>
        ) : (
          <>
            <h2 className="text-sm font-semibold">{heading}</h2>
            {shots.length === 0 ? (
              <p className="rounded-xl border border-line bg-card px-4 py-10 text-center text-sm text-ink-3">Nothing in that folder.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
                {shots.map((s) => (
                  <ShotCard key={s.id} shot={s} />
                ))}
              </div>
            )}
            {!more && shots.length >= 48 ? (
              <Link href={link(cat, "&more=1")} className="inline-block text-sm text-accent hover:underline">
                Show more
              </Link>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
