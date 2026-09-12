"use client";

import { useState } from "react";
import { VoicePlayer } from "@/components/workspace/Voice";
import { IconFile, IconX } from "@/components/ui/icons";
import type { Video } from "@/lib/types";

/**
 * "What did the client actually give us?" — a read-only look at the script
 * and the editor brief without leaving wherever you clicked it from. Used on
 * both the Ready to Edit recap and the Editing status card, so a manager
 * checking in on a claimed video doesn't have to hunt down the original
 * planning pages to see what the editor is working from.
 */
export function ViewMaterialsButton({
  video,
  briefVoiceUrl,
}: {
  video: Video;
  briefVoiceUrl: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"script" | "brief">("script");

  const hasScript = Boolean(video.script_body?.trim() || video.script_hooks?.length);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 transition hover:border-accent hover:text-ink"
      >
        <IconFile size={13} />
        View video
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-8"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl space-y-4 rounded-2xl border border-line bg-card p-5 shadow-2xl"
          >
            <div className="flex items-center gap-2">
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{video.title}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-ink"
              >
                <IconX size={16} />
              </button>
            </div>

            <div className="flex gap-1 border-b border-line pb-2">
              {(["script", "brief"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                    tab === t ? "bg-accent-ghost text-accent-hi" : "text-ink-3 hover:bg-hover hover:text-ink"
                  }`}
                >
                  {t === "script" ? "Script" : "Editor brief"}
                </button>
              ))}
            </div>

            <div className="max-h-[60vh] overflow-y-auto">
              {tab === "script" ? (
                hasScript ? (
                  <div className="space-y-2.5 text-sm">
                    {video.script_hooks?.length ? (
                      <div className="space-y-1.5">
                        {video.script_hooks.map((h, i) => (
                          <p key={i} className="rounded-lg bg-panel px-2.5 py-2 leading-snug">
                            <span className="mr-1.5 text-[10px] uppercase tracking-wider text-ink-3">
                              Hook {i + 1}
                            </span>
                            {h}
                          </p>
                        ))}
                      </div>
                    ) : null}
                    {video.script_body ? (
                      <p className="whitespace-pre-wrap rounded-lg bg-panel px-2.5 py-2 leading-relaxed text-ink-2">
                        {video.script_body}
                      </p>
                    ) : null}
                    {video.script_cta ? (
                      <p className="rounded-lg bg-panel px-2.5 py-2 text-sm">
                        <span className="mr-1.5 text-[10px] uppercase tracking-wider text-ink-3">CTA</span>
                        {video.script_cta}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-ink-3">No script on file.</p>
                )
              ) : briefVoiceUrl || video.brief?.trim() ? (
                <div className="space-y-3">
                  {briefVoiceUrl ? (
                    <VoicePlayer
                      src={briefVoiceUrl}
                      duration={video.brief_voice_duration_seconds}
                      peaks={video.brief_voice_peaks}
                    />
                  ) : null}
                  {video.brief?.trim() ? (
                    <p className="whitespace-pre-wrap rounded-lg bg-panel px-2.5 py-2 text-sm leading-relaxed text-ink-2">
                      {video.brief}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-ink-3">No brief on file.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
