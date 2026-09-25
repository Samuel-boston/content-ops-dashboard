import { notFound } from "next/navigation";
import { StageChat } from "@/components/pipeline/StageChat";
import { requireRole } from "@/lib/auth";
import { getVideo } from "@/app/actions";
import { listAssets } from "@/app/asset-actions";
import { listGuestLinks } from "@/app/guest-actions";
import { getWorkspaceSettings, integrationStatus } from "@/lib/workspace";
import { briefVoiceUrl } from "@/app/script-actions";
import { FilmingWorkspace } from "@/components/script/FilmingWorkspace";

/**
 * The video's filming stage, as its own page — so "Script done" actually
 * lands you looking at what's next for THIS video, not a list. Everything
 * that needs to be ready before it goes to editors lives here: the footage
 * and the brief (spoken or written) — the assembly step the client described
 * that didn't have a home between Scripting and Ready to Edit.
 */
// Designing a thumbnail with ChatGPT can take a minute or two.
export const maxDuration = 300;

export default async function FilmPage({ params }: PageProps<"/videos/[id]/film">) {
  const { id } = await params;
  await requireRole("owner", "admin");

  const video = await getVideo(id);
  if (!video) notFound();

  const [assets, settings, guestLinks] = await Promise.all([
    listAssets(id),
    getWorkspaceSettings(),
    listGuestLinks(id),
  ]);

  const voiceUrl = await briefVoiceUrl(video.brief_voice_path);

  return (
    <FilmingWorkspace
      chat={<StageChat videoId={id} />}
      video={video}
      assets={assets}
      driveConfigured={integrationStatus(settings).drive}
      briefVoiceUrl={voiceUrl}
      guestLinks={guestLinks}
    />
  );
}
