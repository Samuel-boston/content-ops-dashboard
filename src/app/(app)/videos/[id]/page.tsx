import { notFound, redirect } from "next/navigation";
import { isManager, requireUser } from "@/lib/auth";
import { getVideo, listEditors, listTaxonomyCustoms } from "@/app/actions";
import { PLANNING_STAGES } from "@/lib/types";
import { getTranscript, listCutComments, listCuts } from "@/app/engine-actions";
import { listVideoPublishJobs } from "@/app/publishing-actions";
import { listGuestLinks } from "@/app/guest-actions";
import { listActivity, listAssets } from "@/app/asset-actions";
import { listCarouselImages } from "@/app/carousel-actions";
import { listMessages } from "@/app/chat-actions";
import { listMusic, listReferences, videoMusic } from "@/app/library-actions";
import { listSeriesOptions } from "@/app/series-actions";
import { briefVoiceUrl } from "@/app/script-actions";
import { getVideoMetrics } from "@/app/analytics-actions";
import { getWorkspaceSettings, integrationStatus } from "@/lib/workspace";
import { annotateOverdue } from "@/lib/priorities";
import { VideoWorkspace } from "@/components/workspace/VideoWorkspace";
import { EditorVideoView } from "@/components/editor/EditorVideoView";
import { ReadyToEditRecap } from "@/components/pipeline/ReadyToEditRecap";
import { EditingStatusCard } from "@/components/pipeline/EditingStatusCard";
import type { CutComment } from "@/lib/types";

export default async function VideoPage({ params }: PageProps<"/videos/[id]">) {
  const { id } = await params;
  const viewer = await requireUser();

  const [
    video,
    editors,
    customs,
    cuts,
    settings,
    publishJobs,
    assets,
    carouselImages,
    references,
    messages,
    activity,
    metrics,
    guestLinks,
  ] = await Promise.all([
    getVideo(id),
    listEditors(),
    listTaxonomyCustoms(),
    listCuts(id),
    getWorkspaceSettings(),
    listVideoPublishJobs(id),
    listAssets(id),
    listCarouselImages(id),
    listReferences(id),
    listMessages(id),
    listActivity(id),
    getVideoMetrics(id),
    // Owner/admin only: `listGuestLinks` calls requireRole, which *redirects*
    // rather than throwing — so awaiting it as an editor bounced the whole
    // page to "/". Sharing a cut externally is the client's call anyway.
    isManager(viewer.role) ? listGuestLinks(id) : Promise.resolve([]),
  ]);

  if (!video) notFound();

  // A planning-stage video (idea/script/ready-to-film) doesn't have cuts to
  // review yet — the review workspace below is the wrong room for it. Send
  // owners/admins to the dedicated page for whichever stage it's actually
  // in; editors never see planning-stage videos in the first place.
  if (isManager(viewer.role) && PLANNING_STAGES.includes(video.status)) {
    const dest =
      video.status === "ideation"
        ? "idea"
        : video.status === "scripting"
          ? "script"
          : video.status === "ready_to_film"
            ? "film"
            : "editor-brief";
    redirect(`/videos/${id}/${dest}`);
  }

  // Comments for every cut in one pass — the workspace filters client-side as
  // the user switches between the main cut and its hook variants.
  const comments: CutComment[] = (
    await Promise.all(cuts.map((c) => listCutComments(c.id)))
  ).flat();

  // Computed here rather than in a component: comparing against the clock
  // during render is impure and would differ between server and hydration.
  const [{ overdue }] = annotateOverdue([{ eta_at: video.eta_at }]);

  const mainCut = cuts[0];
  const topVersion = mainCut?.versions[0];
  const transcript =
    mainCut && topVersion ? await getTranscript(mainCut.id, topVersion.version) : null;

  const roster = editors.map((e) => ({ id: e.id, full_name: e.full_name, email: e.email }));
  const seriesOptions = await listSeriesOptions();

  // Editors get a working view rather than the client's review workspace: the
  // script, the brief, the references, the footage and the track — what you
  // need to *make* the video, not to judge it. The player is a click away.
  if (!isManager(viewer.role)) {
    const [music, library, briefVoice] = await Promise.all([
      videoMusic(id),
      listMusic(),
      // Never wired up before — the UI to play it existed, but nothing ever
      // signed a URL for it, so the recording was silently unreachable.
      briefVoiceUrl(video.brief_voice_path),
    ]);
    return (
      <EditorVideoView
        video={video}
        viewer={viewer}
        cuts={cuts}
        comments={comments}
        assets={assets}
        carouselImages={carouselImages}
        references={references}
        messages={messages}
        roster={roster}
        music={music}
        musicLibrary={library.tracks}
        seriesOptions={seriesOptions}
        overdue={overdue}
        driveConfigured={integrationStatus(settings).drive}
        streamConfigured={integrationStatus(settings).stream}
        briefVoiceUrl={briefVoice}
      />
    );
  }

  // Ready to Edit hasn't been picked up yet — there's nothing to review, only
  // what Editor Brief handed over to confirm. Editing has a cut in progress
  // but no cut to look at yet either — just who has it and when it's due.
  // Both stay out of the review workspace; From In Review onward there's
  // actually something to judge, so that's where the review workspace starts.
  if (video.status === "ready_to_edit" || video.status === "in_progress") {
    const [music, briefVoice] = await Promise.all([
      videoMusic(id),
      briefVoiceUrl(video.brief_voice_path),
    ]);
    if (video.status === "ready_to_edit") {
      return (
        <ReadyToEditRecap
          video={video}
          assets={assets}
          references={references}
          music={music}
          briefVoiceUrl={briefVoice}
        />
      );
    }
    const editor = roster.find((e) => e.id === video.assigned_editor_id) ?? null;
    return <EditingStatusCard video={video} editor={editor} briefVoiceUrl={briefVoice} />;
  }

  const customsBy = {
    content_pillar: customs.filter((c) => c.kind === "content_pillar").map((c) => c.value),
    format: customs.filter((c) => c.kind === "format").map((c) => c.value),
    platform: customs.filter((c) => c.kind === "platform").map((c) => c.value),
  };

  return (
    <VideoWorkspace
      video={video}
      viewer={viewer}
      cuts={cuts}
      comments={comments}
      transcript={transcript}
      roster={roster}
      customs={customsBy}
      publishJobs={publishJobs}
      overdue={overdue}
      assets={assets}
      carouselImages={carouselImages}
      references={references}
      messages={messages}
      activity={activity}
      metrics={metrics}
      integrations={integrationStatus(settings)}
      guestLinks={guestLinks}
      seriesOptions={seriesOptions}
    />
  );
}
