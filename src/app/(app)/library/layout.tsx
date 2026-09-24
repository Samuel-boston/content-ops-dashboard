import { LibraryTabs } from "@/components/LibraryTabs";
import { supabaseServer } from "@/lib/supabase/server";

export default async function LibraryLayout({ children }: { children: React.ReactNode }) {
  // Tracks dropped in without a category are flagged on the Music tab until someone sorts them.
  const supabase = await supabaseServer();
  const { count } = await supabase
    .from("music_tracks")
    .select("id", { count: "exact", head: true })
    .ilike("category", "uncategori%");
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Library</h1>
        <LibraryTabs uncategorisedMusic={count ?? 0} />
      </div>
      {children}
    </div>
  );
}
