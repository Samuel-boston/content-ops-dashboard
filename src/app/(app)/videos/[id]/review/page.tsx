import { notFound } from "next/navigation";
import { requireUser, isManager } from "@/lib/auth";
import { getVideo, listEditors } from "@/app/actions";
import { listCutComments, listCuts } from "@/app/engine-actions";
import { listCarouselImages } from "@/app/carousel-actions";
import { ReviewMode } from "@/components/ReviewMode";
import type { CutComment } from "@/lib/types";

export default async function ReviewPage({ params }: PageProps<"/videos/[id]/review"> ) {
  const { id } = await params;
  const viewer = await requireUser();
  const [video, cuts, editors, carouselImages] = await Promise.all([
    getVideo(id),
    listCuts(id),
    listEditors(),
    listCarouselImages(id),
  ]);
  if (!video) notFound();

  const commentsByCut: Record<string, CutComment[]> = {};
  await Promise.all(
    cuts.map(async (c) => {
      commentsByCut[c.id] = await listCutComments(c.id);
    })
  );

  const roster = editors.map((e) => ({ id: e.id, full_name: e.full_name, email: e.email }));

  return (
    <div className="mx-auto max-w-2xl">
      <ReviewMode
        video={video}
        viewer={viewer}
        roster={roster}
        cuts={cuts}
        commentsByCut={commentsByCut}
        carouselImages={carouselImages}
        canApprove={isManager(viewer.role)}
      />
    </div>
  );
}
