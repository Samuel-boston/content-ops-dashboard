import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getVideo, listTaxonomyCustoms } from "@/app/actions";
import { briefVoiceUrl, listHookSnippets } from "@/app/script-actions";
import { listCarouselImages } from "@/app/carousel-actions";
import { ScriptWorkspace } from "@/components/script/ScriptWorkspace";

export default async function ScriptPage({ params }: PageProps<"/videos/[id]/script">) {
  const { id } = await params;
  // The script is the client's — editors read it inside the video, they don't
  // get the writing room.
  const viewer = await requireRole("owner", "admin", "copywriter");

  const [video, customs, snippets, carouselSlides] = await Promise.all([
    getVideo(id),
    listTaxonomyCustoms(),
    listHookSnippets(),
    listCarouselImages(id),
  ]);
  if (!video) notFound();

  // Still just an idea — hooks and a CTA are the wrong questions to ask yet.
  if (video.status === "ideation") redirect(`/videos/${id}/idea`);

  const voiceUrl = await briefVoiceUrl(video.brief_voice_path);

  return (
    <ScriptWorkspace
      video={video}
      viewer={viewer}
      customs={{
        content_pillar: customs.filter((c) => c.kind === "content_pillar").map((c) => c.value),
        format: customs.filter((c) => c.kind === "format").map((c) => c.value),
        platform: customs.filter((c) => c.kind === "platform").map((c) => c.value),
      }}
      briefVoiceUrl={voiceUrl}
      snippets={snippets}
      carouselSlides={carouselSlides}
    />
  );
}
