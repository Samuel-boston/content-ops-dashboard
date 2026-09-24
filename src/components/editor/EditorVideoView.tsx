"use client";

import { useClientName } from "@/components/ClientName";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { Avatar } from "@/components/ui/Avatar";
import { Chip, PriorityPill } from "@/components/badges";
import { EtaBadge } from "@/components/pipeline/Eta";
import { ClaimDialog } from "@/components/pipeline/Eta";
import { ReturnToBay } from "@/components/pipeline/ReturnToBay";
import { StageActions } from "@/components/pipeline/StageActions";
import { UploadDropzone } from "@/components/engine/UploadDropzone";
import { CarouselDeliver } from "@/components/editor/CarouselDeliver";
import { FinishedLinks } from "@/components/editor/FinishedLinks";
import { BriefAttachments } from "@/components/BriefAttachments";
import { MusicPicker } from "@/components/workspace/MusicPicker";
import { SeriesPicker } from "@/components/workspace/SeriesPicker";
import { VoicePlayer } from "@/components/workspace/Voice";
import { VideoReferences } from "@/components/VideoReferences";
import { VideoFootage } from "@/components/VideoFootage";
import { VideoChat } from "@/components/VideoChat";
import { addHookVariantAction } from "@/app/engine-actions";
import { isCarouselFormat } from "@/lib/taxonomy";
import {
  IconChevronRight,
  IconClock,
  IconComment,
  IconDraw,
  IconFile,
  IconPlay,
  IconPlus,
} from "@/components/ui/icons";
import { dayMonth, displayName, readTime, timecode } from "@/lib/format";
import {
  STATUS_COLOR,
  STATUS_LABELS,
  type CarouselImage,
  type CutComment,
  type CutWithVersions,
  type MusicTrack,
  type Profile,
  type ReferenceItem,
  type Series,
  type Video,
  type VideoAsset,
  type VideoMessage,
} from "@/lib/types";

/**
 * The editor's view of a video: everything needed to cut it, in one place.
 *
 * Deliberately not the client's review workspace. That page is built around
 * *judging* a cut — a player, a timeline, comments pinned to frames. This one
 * is built around *making* it: the script to work from, the brief, the
 * references, the footage, the track, and what the client has already said.
 * The review player is one click away for watching feedback in context.
 */
export function EditorVideoView({
  video,
  viewer,
  cuts,
  comments,
  assets,
  carouselImages,
  references,
  messages,
  roster,
  music,
  musicLibrary,
  seriesOptions,
  overdue,
  driveConfigured,
  streamConfigured,
  briefVoiceUrl,
}: {
  video: Video;
  viewer: Profile;
  cuts: CutWithVersions[];
  comments: CutComment[];
  assets: VideoAsset[];
  carouselImages: CarouselImage[];
  references: ReferenceItem[];
  messages: VideoMessage[];
  roster: Pick<Profile, "id" | "full_name" | "email">[];
  music: MusicTrack[];
  musicLibrary: MusicTrack[];
  seriesOptions: Series[];
  overdue: boolean;
  driveConfigured: boolean;
  streamConfigured: boolean;
  briefVoiceUrl: string | null;
}) {
  const clientName = useClientName();
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTrackedTransition();
  const [settingEta, setSettingEta] = useState(false);
  const [addingHook, setAddingHook] = useState(false);
  const [hookLabel, setHookLabel] = useState("");
  const [hookNotes, setHookNotes] = useState("");

  const mine = video.assigned_editor_id === viewer.id;
  const carousel = isCarouselFormat(video.formats);
  const hasScript = Boolean(video.script_body?.trim() || video.script_hooks?.length);
  const fullRead = readTime(
    [video.script_hooks?.[0] ?? "", video.script_body ?? "", video.script_cta ?? ""]
      .filter(Boolean)
      .join(" ")
  );

  // The client's notes, newest first. Internal ones never reach here — they're
  // filtered server-side by visibility.
  const openNotes = comments.filter((c) => !c.resolved);

  return (
    <div className="space-y-5">
      {/* ---- Header ---- */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/my-work" className="text-sm text-ink-3 hover:text-ink">
            My Work
          </Link>
          <IconChevronRight size={12} className="text-ink-3" />
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{video.title}</h1>
          {cuts.length > 0 ? (
            <Link
              href={`/videos/${video.id}/review`}
              className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 transition hover:border-accent hover:text-ink"
            >
              <IconPlay size={12} />
              Watch the cut
            </Link>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]"
            style={{
              color: STATUS_COLOR[video.status],
              background: `color-mix(in srgb, ${STATUS_COLOR[video.status]} 12%, transparent)`,
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: STATUS_COLOR[video.status] }}
            />
            {STATUS_LABELS[video.status]}
          </span>

          <PriorityPill priority={video.priority} />

          {video.eta_at ? (
            <button
              type="button"
              onClick={() => setSettingEta(true)}
              title="Change your delivery date"
              className="rounded-md"
            >
              <EtaBadge etaAt={video.eta_at} stage={video.eta_stage} overdue={overdue} />
            </button>
          ) : mine ? (
            <button
              type="button"
              onClick={() => setSettingEta(true)}
              className="flex items-center gap-1.5 rounded-md bg-warn/10 px-2 py-1 text-[11px] text-warn hover:bg-warn/20"
            >
              <IconClock size={11} />
              Set a delivery date
            </button>
          ) : null}

          {video.post_date ? (
            <span className="text-[11px] text-ink-3">posts {dayMonth(video.post_date)}</span>
          ) : null}

          {[...(video.formats ?? []), ...(video.platforms ?? [])].slice(0, 3).map((t) => (
            <Chip key={t}>{t}</Chip>
          ))}

          <span className="ml-auto flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <StageActions video={video} viewer={viewer} overdue={overdue} />
            {mine && video.status !== "posted" ? (
              <ReturnToBay videoId={video.id} mine />
            ) : null}
          </span>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ---- Left: what to make ---- */}
        <div className="min-w-0 space-y-4">
          {/* The brief — first, because it's what everything below is measured against. */}
          <section className="rounded-xl border border-line bg-card p-4">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              Brief
            </h2>
            {video.brief ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">
                {video.brief}
              </p>
            ) : !briefVoiceUrl ? (
              <p className="text-xs text-ink-3">
                No brief written for this one — check the script, or ask {clientName} below.
              </p>
            ) : null}
            {briefVoiceUrl ? (
              <div className={video.brief ? "mt-2" : ""}>
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-ink-3">
                  Spoken brief — {clientName}&rsquo;s own recording, not a summary
                </span>
                <audio src={briefVoiceUrl} controls className="h-9 w-full" />
              </div>
            ) : null}
            {/* Screenshots, clips and screen recordings the client attached to the brief. */}
            {assets.some((a) => a.kind === "other") ? (
              <div className="mt-3">
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-ink-3">
                  Attached to the brief
                </span>
                <BriefAttachments videoId={video.id} assets={assets} />
              </div>
            ) : null}
          </section>

          {/*
            Delivering the cut — the editor's whole job, and until now the one
            thing this page couldn't do. The upload dropzone lived only in the
            client's workspace, which editors never see.
          */}
          {video.status !== "posted" ? (
            <section className="rounded-xl border border-accent/30 bg-accent-ghost p-4">
              <div className="mb-2 flex flex-wrap items-baseline gap-2">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                  Finished video
                </h2>
                <span className="text-[11px] text-ink-3">
                  {carousel
                    ? "Drop the carousel images here, then submit it for review."
                    : video.status === "awaiting_variants"
                      ? "Upload a variant for each extra hook, then submit."
                      : "Upload it here or add a link, then submit it for review."}
                </span>
              </div>

              {carousel ? (
                <CarouselDeliver videoId={video.id} images={carouselImages} />
              ) : cuts.length === 0 ? (
                <p className="rounded-lg bg-card px-3 py-2.5 text-[11px] text-ink-3">
                  No cut has been set up for this video yet — ask {clientName} to create one.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {cuts.map((cut) => {
                    const latest = cut.versions[0];
                    return (
                      <div key={cut.id} className="rounded-lg bg-card p-2.5">
                        <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
                          {/* One cut needs no name — "Main cut" was just noise. */}
                          {cuts.length > 1 ? (
                            <span className="text-xs font-medium">{cut.label}</span>
                          ) : null}
                          {latest ? (
                            <span className="text-[10px] text-ink-3">
                              v{latest.version}
                              {latest.duration_seconds
                                ? ` · ${timecode(latest.duration_seconds)}`
                                : ""}
                              {latest.status !== "ready" ? ` · ${latest.status}` : ""}
                            </span>
                          ) : (
                            <span className="text-[10px] text-warn">nothing uploaded yet</span>
                          )}
                          {latest?.status === "ready" ? (
                            <Link
                              href={`/videos/${video.id}/review`}
                              className="ml-auto text-[10px] text-accent-hi hover:underline"
                            >
                              watch it →
                            </Link>
                          ) : null}
                        </div>
                        {streamConfigured ? (
                          <UploadDropzone cutId={cut.id} compact />
                        ) : (
                          <p className="rounded-lg border border-dashed border-line-strong px-3 py-2.5 text-center text-[11px] text-ink-3">
                            Cloudflare Stream isn&rsquo;t connected yet — ask {clientName} to add it
                            in Settings → Integrations before you can upload.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {!carousel ? (
                <div className="mt-2.5">
                  <FinishedLinks videoId={video.id} assets={assets} canEdit />
                </div>
              ) : null}

              {/* A scripted video with more than one hook needs a cut for
                  each — this is the only place an editor can add one.
                  Doesn't apply to carousels — there's no per-hook cut. */}
              {!carousel && (video.script_hooks?.length ?? 0) > 1 ? (
                <div className="mt-2.5 border-t border-line/60 pt-2.5">
                  {addingHook ? (
                    <div className="space-y-1.5 rounded-lg bg-card p-2.5">
                      <input
                        value={hookLabel}
                        onChange={(e) => setHookLabel(e.target.value)}
                        placeholder="Label — e.g. Hook B"
                        className="w-full rounded-md bg-raised px-2 py-1.5 text-xs placeholder:text-ink-3 focus:outline-none"
                      />
                      <textarea
                        value={hookNotes}
                        onChange={(e) => setHookNotes(e.target.value)}
                        rows={2}
                        placeholder="What's different about this hook?"
                        className="w-full resize-none rounded-md bg-raised px-2 py-1.5 text-xs placeholder:text-ink-3 focus:outline-none"
                      />
                      <div className="flex flex-wrap gap-1">
                        {video.script_hooks.map((h, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => {
                              // Just the name — the hook's own text isn't what
                              // "what's different" is asking for.
                              setHookLabel(`Hook ${String.fromCharCode(65 + i)}`);
                            }}
                            title={h}
                            className="max-w-full truncate rounded-md border border-line px-2 py-1 text-[10px] text-ink-3 hover:border-accent hover:text-ink"
                          >
                            Hook {String.fromCharCode(65 + i)}
                          </button>
                        ))}
                      </div>
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setAddingHook(false)}
                          className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:bg-hover"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            startTransition(async () => {
                              const res = await addHookVariantAction(video.id, hookLabel, hookNotes);
                              if (res?.error) toast.error(res.error);
                              else {
                                setHookLabel("");
                                setHookNotes("");
                                setAddingHook(false);
                                router.refresh();
                              }
                            })
                          }
                          className="rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-accent-hi"
                        >
                          Add variant
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAddingHook(true)}
                      className="flex items-center gap-1.5 text-[11px] text-accent-hi hover:underline"
                    >
                      <IconPlus size={11} />
                      Add a hook variant — script has {video.script_hooks.length}, {" "}
                      {cuts.filter((c) => c.kind === "hook").length} uploaded
                    </button>
                  )}
                </div>
              ) : null}
            </section>
          ) : null}

          {/* What the client has said */}
          {openNotes.length > 0 ? (
            <section className="rounded-xl border border-stage-revisions/40 bg-stage-revisions/5 p-4">
              <h2 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                <IconComment size={12} />
                Open notes from {clientName}
                <span className="text-ink-3">{openNotes.length}</span>
              </h2>

              <div className="space-y-1.5">
                {openNotes.slice(0, 6).map((c) => (
                  <Link
                    key={c.id}
                    href={`/videos/${video.id}/review`}
                    className="block rounded-lg bg-card px-2.5 py-2 transition hover:bg-hover"
                  >
                    <span className="flex items-center gap-1.5 text-[10px] text-ink-3">
                      {c.author ? <Avatar person={c.author} size="xs" /> : null}
                      {c.author ? displayName(c.author) : clientName}
                      {c.t_start_seconds != null ? (
                        <span className="font-mono">{timecode(c.t_start_seconds)}</span>
                      ) : null}
                      {c.drawing ? (
                        <span title="Has a drawing — open to see it">
                          <IconDraw size={10} />
                        </span>
                      ) : null}
                    </span>
                    {c.body ? (
                      <span className="mt-0.5 block text-xs leading-snug text-ink-2">
                        {c.body}
                      </span>
                    ) : null}
                    {c.voice_url ? (
                      <span
                        className="mt-1.5 block"
                        onClick={(e) => {
                          // This sits inside a Link — stopPropagation alone
                          // stops Link's own handler but leaves the browser's
                          // native "follow the href" behaviour untouched, so
                          // playing the note would still navigate away.
                          // preventDefault is what actually cancels that.
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      >
                        <VoicePlayer
                          src={c.voice_url}
                          duration={c.voice_duration_seconds}
                          peaks={c.voice_peaks}
                          compact
                        />
                      </span>
                    ) : null}
                  </Link>
                ))}
                {openNotes.length > 6 ? (
                  <Link
                    href={`/videos/${video.id}/review`}
                    className="block px-2.5 py-1 text-[11px] text-accent-hi hover:underline"
                  >
                    {openNotes.length - 6} more →
                  </Link>
                ) : null}
              </div>
            </section>
          ) : null}

          {/* The script */}
          <section className="rounded-xl border border-line bg-card p-4">
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                Script
              </h2>
              {hasScript ? (
                <span className="ml-auto text-[11px] tabular-nums text-ink-3">
                  {fullRead.words} words · {fullRead.label} spoken
                </span>
              ) : null}
            </div>

            {!hasScript ? (
              <p className="rounded-lg bg-panel px-3 py-2.5 text-xs text-ink-3">
                No script on this one — work from the brief above.
              </p>
            ) : (
              <div className="space-y-3">
                {video.script_hooks?.length ? (
                  <div>
                    <span className="mb-1 block text-[10px] uppercase tracking-wider text-ink-3">
                      {video.script_hooks.length > 1
                        ? `Hooks — ${video.script_hooks.length}, one variant each`
                        : "Hook"}
                    </span>
                    <div className="space-y-1">
                      {video.script_hooks.map((h, i) => (
                        <p
                          key={`${i}-${h.slice(0, 10)}`}
                          className="flex gap-2 rounded-lg bg-panel px-2.5 py-2 text-sm leading-snug"
                        >
                          <span className="shrink-0 font-mono text-[11px] text-ink-3">
                            {i + 1}
                          </span>
                          {h}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}

                {video.script_body ? (
                  <div>
                    <span className="mb-1 block text-[10px] uppercase tracking-wider text-ink-3">
                      Body
                    </span>
                    <p className="whitespace-pre-wrap rounded-lg bg-panel px-2.5 py-2 text-sm leading-relaxed">
                      {video.script_body}
                    </p>
                  </div>
                ) : null}

                {video.script_cta ? (
                  <div>
                    <span className="mb-1 block text-[10px] uppercase tracking-wider text-ink-3">
                      Call to action
                    </span>
                    <p className="whitespace-pre-wrap rounded-lg bg-panel px-2.5 py-2 text-sm leading-relaxed">
                      {video.script_cta}
                    </p>
                  </div>
                ) : null}
              </div>
            )}
          </section>

          {/* Footage */}
          <section className="rounded-xl border border-line bg-card p-4">
            <h2 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              <IconFile size={12} />
              Footage &amp; files
            </h2>
            <VideoFootage videoId={video.id} assets={assets} driveConfigured={driveConfigured} />
          </section>

          {/* Talk to the client */}
          <section className="rounded-xl border border-line bg-card p-4">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              Questions for {clientName}
            </h2>
            <VideoChat videoId={video.id} viewer={viewer} messages={messages} roster={roster} />
          </section>
        </div>

        {/* ---- Right: what to make it with ---- */}
        <aside className="space-y-4">
          <SeriesPicker
            videoId={video.id}
            seriesId={video.series_id}
            position={video.series_position}
            options={seriesOptions}
            canEdit={false}
          />

          <MusicPicker
            videoId={video.id}
            attached={music}
            library={musicLibrary}
            canEdit
          />

          <section className="rounded-xl border border-line bg-card p-4">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              References
            </h2>
            <VideoReferences videoId={video.id} items={references} />
          </section>

          <section className="rounded-xl border border-line bg-card p-4">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              Where it&rsquo;s going
            </h2>
            <dl className="space-y-1.5 text-[11px]">
              {[
                ["Pillars", (video.content_pillars ?? []).join(", ")],
                ["Formats", (video.formats ?? []).join(", ")],
                ["Platforms", (video.platforms ?? []).join(", ")],
                ["Post date", video.post_date ? dayMonth(video.post_date) : ""],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="w-20 shrink-0 text-ink-3">{k}</dt>
                  <dd className="min-w-0 flex-1 text-ink-2">{v || "—"}</dd>
                </div>
              ))}
            </dl>
          </section>
        </aside>
      </div>

      <ClaimDialog
        open={settingEta}
        videoId={video.id}
        title={video.title}
        mode="eta"
        currentEta={video.eta_at}
        onClose={() => setSettingEta(false)}
      />
    </div>
  );
}
