import { requireUser } from "@/lib/auth";
import { attachableVideos, listMusicWithUsage } from "@/app/library-actions";
import { MusicLibrary } from "@/components/MusicLibrary";

export default async function MusicPage() {
  await requireUser();
  const [{ categories, tracks }, attachTo] = await Promise.all([
    listMusicWithUsage(),
    attachableVideos(),
  ]);
  return <MusicLibrary categories={categories} tracks={tracks} attachTo={attachTo} />;
}
