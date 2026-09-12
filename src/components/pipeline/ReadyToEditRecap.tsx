import Link from "next/link";
import { ViewMaterialsButton } from "@/components/pipeline/ViewMaterials";
import { IconCheck } from "@/components/ui/icons";
import { PRIORITY_LABELS } from "@/lib/types";
import type { MusicTrack, ReferenceItem, Video, VideoAsset } from "@/lib/types";

/**
 * What "Ready to Edit" opens onto for a manager: everything Editor Brief
 * finished, laid out to confirm — not the cuts/comments review workspace,
 * which doesn't exist yet for a video that hasn't been picked up.
 */
export function ReadyToEditRecap({
  video,
  assets,
  references,
  music,
  briefVoiceUrl,
}: {
  video: Video;
  assets: VideoAsset[];
  references: ReferenceItem[];
  music: MusicTrack[];
  briefVoiceUrl: string | null;
}) {
  const clips = assets.filter((a) => a.kind === "other");
  const footage = assets.filter((a) => a.kind === "raw");

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/board" className="text-sm text-ink-3 hover:text-ink">
          Board
        </Link>
        <span className="text-ink-3">/</span>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{video.title}</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-md bg-ok/10 px-2 py-1 text-[11px] text-ok">
          <IconCheck size={11} />
          In the editors&rsquo; pool
        </span>
        <span className="rounded-md bg-panel px-2 py-1 text-[11px] text-ink-2">
          {PRIORITY_LABELS[video.priority]} priority
        </span>
        <div className="ml-auto">
          <ViewMaterialsButton video={video} briefVoiceUrl={briefVoiceUrl} />
        </div>
      </div>

      <p className="text-xs text-ink-3">
        Waiting for an editor to pick it up. This is everything handed over from Editor Brief —
        nothing to review yet.
      </p>

      <section className="rounded-2xl border border-line bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">Brief</h2>
        {video.brief?.trim() || briefVoiceUrl ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">
            {video.brief?.trim() || "(spoken brief only — open View video to hear it)"}
          </p>
        ) : (
          <p className="text-sm text-ink-3">No brief was left for this one.</p>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Raw footage</h2>
          {footage.length ? (
            <ul className="space-y-1 text-sm text-ink-2">
              {footage.map((a) => (
                <li key={a.id} className="truncate">
                  {a.label}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">None on file.</p>
          )}
        </div>
        <div className="rounded-2xl border border-line bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Music</h2>
          {music.length ? (
            <ul className="space-y-1 text-sm text-ink-2">
              {music.map((m) => (
                <li key={m.id} className="truncate">
                  {m.title}
                  {m.mood ? <span className="text-ink-3"> · {m.mood}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">No track tagged.</p>
          )}
        </div>
      </section>

      {references.length || clips.length ? (
        <section className="rounded-2xl border border-line bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">References &amp; recordings</h2>
          <ul className="space-y-1 text-sm text-ink-2">
            {references.map((r) => (
              <li key={r.id} className="truncate">
                {r.note || r.kind}
              </li>
            ))}
            {clips.map((c) => (
              <li key={c.id} className="truncate">
                {c.label}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
