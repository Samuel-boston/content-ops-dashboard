import { notFound, redirect } from "next/navigation";
import { StageChat } from "@/components/pipeline/StageChat";
import { requireRole } from "@/lib/auth";
import { getVideo, listTaxonomyCustoms } from "@/app/actions";
import { listReferences } from "@/app/library-actions";
import { listCarouselImages } from "@/app/carousel-actions";
import { IdeaWorkspace } from "@/components/script/IdeaWorkspace";

export default async function IdeaPage({ params }: PageProps<"/videos/[id]/idea">) {
  const { id } = await params;
  // Ideation is the client's private shelf — editors never see this stage.
  const viewer = await requireRole("owner", "admin", "copywriter");

  const [video, customs, references, carouselSlides] = await Promise.all([
    getVideo(id),
    listTaxonomyCustoms(),
    listReferences(id),
    listCarouselImages(id),
  ]);
  if (!video) notFound();

  // Once it's being written, the script editor is the right room. Sending it on
  // rather than showing a stale brainstorm keeps the two surfaces honest.
  if (video.status !== "ideation") redirect(`/videos/${id}/script`);

  return (
    <IdeaWorkspace
      chat={<StageChat videoId={id} />}
      video={video}
      viewer={viewer}
      customs={{
        content_pillar: customs.filter((c) => c.kind === "content_pillar").map((c) => c.value),
        format: customs.filter((c) => c.kind === "format").map((c) => c.value),
        platform: customs.filter((c) => c.kind === "platform").map((c) => c.value),
      }}
      references={references}
      carouselSlides={carouselSlides}
    />
  );
}
