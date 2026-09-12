import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getVideo, listTaxonomyCustoms } from "@/app/actions";
import { briefVoiceUrl } from "@/app/script-actions";
import { listReferences } from "@/app/library-actions";
import { IdeaWorkspace } from "@/components/script/IdeaWorkspace";

export default async function IdeaPage({ params }: PageProps<"/videos/[id]/idea">) {
  const { id } = await params;
  // Ideation is the client's private shelf — editors never see this stage.
  const viewer = await requireRole("owner", "admin");

  const [video, customs, references] = await Promise.all([
    getVideo(id),
    listTaxonomyCustoms(),
    listReferences(id),
  ]);
  if (!video) notFound();

  // Once it's being written, the script editor is the right room. Sending it on
  // rather than showing a stale brainstorm keeps the two surfaces honest.
  if (video.status !== "ideation") redirect(`/videos/${id}/script`);

  const voiceUrl = await briefVoiceUrl(video.brief_voice_path);

  return (
    <IdeaWorkspace
      video={video}
      viewer={viewer}
      customs={{
        content_pillar: customs.filter((c) => c.kind === "content_pillar").map((c) => c.value),
        format: customs.filter((c) => c.kind === "format").map((c) => c.value),
        platform: customs.filter((c) => c.kind === "platform").map((c) => c.value),
      }}
      briefVoiceUrl={voiceUrl}
      references={references}
    />
  );
}
