import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getVideo } from "@/app/actions";
import { listAssets } from "@/app/asset-actions";
import { listMusic, listReferences, videoMusic } from "@/app/library-actions";
import { briefVoiceUrl } from "@/app/script-actions";
import { EditorBriefWorkspace } from "@/components/script/EditorBriefWorkspace";

/**
 * The assembly step between "filmed" and "with the editors" — the brief
 * (voice/written), a screen recording, references, the track and the
 * priority call all get finished here before "Send to editors" hands it off.
 */
export default async function EditorBriefPage({ params }: PageProps<"/videos/[id]/editor-brief">) {
  const { id } = await params;
  await requireRole("owner", "admin");

  const video = await getVideo(id);
  if (!video) notFound();

  const [assets, references, music, library] = await Promise.all([
    listAssets(id),
    listReferences(id),
    videoMusic(id),
    listMusic(),
  ]);

  const voiceUrl = await briefVoiceUrl(video.brief_voice_path);

  return (
    <EditorBriefWorkspace
      video={video}
      assets={assets}
      references={references}
      music={music}
      musicLibrary={library.tracks}
      briefVoiceUrl={voiceUrl}
    />
  );
}
