import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { syncPendingVersions } from "@/lib/stream-sync";
import { isManager, requireUser } from "@/lib/auth";
import { getVideo, listTaxonomyCustoms, listTeam } from "@/app/actions";
import { PLANNING_STAGES, type VideoStatus } from "@/lib/types";
import { isCarouselFormat } from "@/lib/taxonomy";
import { listCutComments, listCuts } from "@/app/engine-actions";
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
import { listScriptComments } from "@/app/script-comment-actions";
import { StageChat } from "@/components/pipeline/StageChat";
import { CarouselPostView } from "@/components/script/CarouselPostView";
import type { CutComment } from "@/lib/types";

// Designing a thumbnail with ChatGPT can take a minute or two.
export const maxDuration = 300;

export default async function VideoPage({ params }: PageProps<"/videos/[id]">) {
  const { id } = await params;
  const viewer = await requireUser();
  // Finish any upload whose page was closed while Cloudflare was still processing.
  after(() => syncPendingVersions(id));

  const [
    video,
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
  // in; editors never see planning-stage videos in the first place. The
  // copywriter lands on the idea/script rooms too — but never on /film or
  // /editor-brief, which stay manager-only (their gates would bounce the
  // whole page): everything past scripting reads as the script room to them.
  if (isManager(viewer.role) && PLANNING_STAGES.includes(video.status)) {
    const dest =
      video.status === "ideation"
        ? "idea"
        : video.status === "scripting"
          ? "script"
          : video.status === "ready_to_film"
            ? "film"
            : "film";
    redirect(`/videos/${id}/${dest}`);
  }
  if (viewer.role === "copywriter" && PLANNING_STAGES.includes(video.status)) {
    redirect(`/videos/${id}/${video.status === "ideation" ? "idea" : "script"}`);
  }

  // Comments for every cut in one pass — the workspace filters client-side as
  // the user switches between the main cut and its hook variants.
  const comments: CutComment[] = (
    await Promise.all(cuts.map((c) => listCutComments(c.id)))
  ).flat();

  // Computed here rather than in a component: comparing against the clock
  // during render is impure and would differ between server and hydration.
  const [{ overdue }] = annotateOverdue([{ eta_at: video.eta_at }]);

  // Everyone who can be @-mentioned in this video's chat and comments — the
  // whole active team, not just editors. An editor couldn't tag the client and
  // the client couldn't tag the copywriter or VA. Roles are folded into the
  // list only to keep the assigned-editor lookup below working.
  const team = (await listTeam()).filter((p) => p.active);
  const roster = team.map((e) => ({ id: e.id, full_name: e.full_name, email: e.email }));
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
    const editorView = (
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

    // Once a finished video has been uploaded, the editor is in the same room
    // the client reviews in — player, timeline comments, replies, resolving,
    // chat, files and share links, plus the stage buttons — for every stage
    // from there on (in review, revisions, awaiting variants, final review,
    // with the VA, posted). The only thing they don't get is the client's
    // Post tab. Delivering more cuts and hook variants happens in its Files tab.
    // Before anything is uploaded, they get their own working view instead.
    const REVIEW_ROOM: VideoStatus[] = [
      "in_review",
      "revisions",
      "approved",
      "awaiting_variants",
      "final_review",
      "with_va",
      "posted",
    ];
    const hasUpload = cuts.some((c) => c.versions.length > 0);
    if (REVIEW_ROOM.includes(video.status) || (video.status === "in_progress" && hasUpload)) {
      const links = video.assigned_editor_id === viewer.id ? await listGuestLinks(id) : [];
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
          roster={roster}
          customs={customsBy}
          publishJobs={[]}
          overdue={overdue}
          assets={assets}
          carouselImages={carouselImages}
          references={references}
          messages={messages}
          activity={activity}
          metrics={metrics}
          integrations={integrationStatus(settings)}
          guestLinks={links}
          seriesOptions={seriesOptions}
        />
      );
    }
    return editorView;
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
          guestLinks={guestLinks}
          driveConfigured={integrationStatus(settings).drive}
        />
      );
    }
    const editor = roster.find((e) => e.id === video.assigned_editor_id) ?? null;
    return <EditingStatusCard video={video} editor={editor} briefVoiceUrl={briefVoice} />;
  }

  // A carousel skips the whole editing chain — approving its script lands it
  // on Creatives (making the images), then straight to the VA. This is the only room past Scripting it ever has — the generic
  // review workspace below assumes a cut exists, which a carousel never has.
  const CAROUSEL_POST_STATUSES: VideoStatus[] = [
    "needs_creatives",
    "with_va",
    "posted",
  ];
  if (isCarouselFormat(video.formats) && CAROUSEL_POST_STATUSES.includes(video.status)) {
    const slideComments = await listScriptComments(id);
    return (
      <CarouselPostView
        video={video}
        carouselSlides={carouselImages}
        chat={<StageChat videoId={id} />}
        comments={slideComments}
        viewer={viewer}
      />
    );
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
