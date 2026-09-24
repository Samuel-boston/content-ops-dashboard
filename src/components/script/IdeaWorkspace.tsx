"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { TaxonomyMultiSelect } from "@/components/TaxonomyMultiSelect";
import { VideoReferences } from "@/components/VideoReferences";
import { PlanningStageBar } from "@/components/pipeline/PlanningStageBar";
import { CarouselSlides } from "@/components/script/CarouselSlides";
import { StageMove } from "@/components/pipeline/StageMove";
import { saveIdeaNotesAction } from "@/app/script-actions";
import { updateVideoAction } from "@/app/actions";
import { isCarouselFormat } from "@/lib/taxonomy";
import type { CarouselImage, Profile, ReferenceItem, Video } from "@/lib/types";

/**
 * The idea shelf, opened up.
 *
 * Clicking an idea used to drop you into the script editor — hooks, body, CTA,
 * a read-time counter — which is a set of questions you can't answer yet. An
 * idea at this stage is a sentence and a hunch. So this is a page for thinking:
 * a big empty box, a voice recorder for when typing is too slow, and the tags
 * you already know. The script editor is one click away, and it appears the
 * moment you say the idea is worth writing.
 */
export function IdeaWorkspace({
  video,
  viewer,
  customs,
  references,
  carouselSlides,
  chat,
}: {
  video: Video;
  viewer: Profile;
  customs: { content_pillar: string[]; format: string[]; platform: string[] };
  references: ReferenceItem[];
  carouselSlides: CarouselImage[];
  chat?: React.ReactNode;
}) {
  const toast = useToast();
  const router = useRouter();
  const [, startTransition] = useTrackedTransition();

  const [notes, setNotes] = useState(video.idea_notes ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const canEdit = viewer.role === "owner" || viewer.role === "admin";

  const save = useCallback(
    (value: string) => {
      setSaving(true);
      startTransition(async () => {
        const res = await saveIdeaNotesAction(video.id, value);
        setSaving(false);
        if (res?.error) toast.error(res.error);
        else setDirty(false);
      });
    },
    [video.id, toast, startTransition]
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/ideation" className="text-sm text-ink-3 hover:text-ink">
              Ideation
            </Link>
            <span className="text-ink-3">/</span>
            <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{video.title}</h1>
          </div>
          <PlanningStageBar
            videoId={video.id}
            current={video.status}
            canEdit
            carousel={isCarouselFormat(video.formats)}
            lockedStages={canEdit ? [] : ["ready_to_film"]}
          />
          {/* The obvious next move, right under the stepper rather than only up in it. */}
          <div className="flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-2">
            <span className="text-[11px] text-ink-3">Next step</span>
            <span className="ml-auto">
              <StageMove
                videoId={video.id}
                to="scripting"
                label="Start scripting"
                goTo={`/videos/${video.id}/script`}
              />
            </span>
          </div>
        </div>

        {isCarouselFormat(video.formats) ? (
          <CarouselSlides
            videoId={video.id}
            slides={carouselSlides}
            carouselStyle={video.carousel_style}
          />
        ) : null}

        <section className="rounded-2xl border border-line bg-card p-4">
          <div className="mb-2 flex items-baseline gap-2">
            <h2 className="text-sm font-semibold">Thinking</h2>
            <span className="ml-auto text-[11px] text-ink-3">
              {saving ? "Saving…" : dirty ? "Unsaved" : "Saved"}
            </span>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-ink-3">
            Nothing here has to be good. Angles, references, a line you overheard, why this might
            not work. It all carries through to the script when you&rsquo;re ready.
          </p>
          <textarea
            value={notes}
            rows={20}
            placeholder="What&rsquo;s the idea?"
            onChange={(e) => {
              setNotes(e.target.value);
              setDirty(true);
            }}
            onBlur={() => dirty && save(notes)}
            className="w-full resize-y bg-transparent text-sm leading-relaxed placeholder:text-ink-3 focus:outline-none"
          />
        </section>
      </div>

      <aside className="space-y-4">
        <section className="rounded-2xl border border-line bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">References</h2>
          <p className="mb-2.5 text-xs leading-relaxed text-ink-3">
            Anything that shaped the idea — a video you liked, a screenshot, a link.
          </p>
          <VideoReferences videoId={video.id} items={references} />
        </section>

        <section className="space-y-3 rounded-2xl border border-line bg-card p-4">
          <h2 className="text-sm font-semibold">Where it fits</h2>
          <p className="text-[11px] leading-snug text-ink-3">
            Optional now — but tagging early is what makes the analytics worth reading later.
          </p>
          <TaxonomyMultiSelect
            kind="content_pillar"
            selected={video.content_pillars}
            customs={customs.content_pillar}
            onChange={(content_pillars) =>
              startTransition(async () => {
                await updateVideoAction(video.id, { content_pillars });
                router.refresh();
              })
            }
          />
          <TaxonomyMultiSelect
            kind="format"
            selected={video.formats}
            customs={customs.format}
            onChange={(formats) =>
              startTransition(async () => {
                await updateVideoAction(video.id, { formats });
                router.refresh();
              })
            }
          />
          <TaxonomyMultiSelect
            kind="platform"
            selected={video.platforms}
            customs={customs.platform}
            onChange={(platforms) =>
              startTransition(async () => {
                await updateVideoAction(video.id, { platforms });
                router.refresh();
              })
            }
          />
        </section>

        {chat}
      </aside>
    </div>
  );
}
