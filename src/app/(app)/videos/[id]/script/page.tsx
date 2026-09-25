import { notFound, redirect } from "next/navigation";
import { StageChat } from "@/components/pipeline/StageChat";
import { requireRole } from "@/lib/auth";
import { getVideo, listTaxonomyCustoms } from "@/app/actions";
import { listReferences } from "@/app/library-actions";
import { listScriptComments } from "@/app/script-comment-actions";
import { listCarouselImages } from "@/app/carousel-actions";
import { ScriptWorkspace } from "@/components/script/ScriptWorkspace";

// Designing a thumbnail with ChatGPT can take a minute or two.
export const maxDuration = 300;

export default async function ScriptPage({ params }: PageProps<"/videos/[id]/script">) {
  const { id } = await params;
  // The script is the client's — editors read it inside the video, they don't
  // get the writing room.
  const viewer = await requireRole("owner", "admin", "copywriter");

  const [video, customs, references, carouselSlides, comments] = await Promise.all([
    getVideo(id),
    listTaxonomyCustoms(),
    listReferences(id),
    listCarouselImages(id),
    listScriptComments(id),
  ]);
  if (!video) notFound();

  // Still just an idea — hooks and a CTA are the wrong questions to ask yet.
  if (video.status === "ideation") redirect(`/videos/${id}/idea`);

  return (
    <ScriptWorkspace
      chat={<StageChat videoId={id} />}
      video={video}
      viewer={viewer}
      customs={{
        content_pillar: customs.filter((c) => c.kind === "content_pillar").map((c) => c.value),
        format: customs.filter((c) => c.kind === "format").map((c) => c.value),
        platform: customs.filter((c) => c.kind === "platform").map((c) => c.value),
      }}
      references={references}
      comments={comments}
      carouselSlides={carouselSlides}
    />
  );
}
