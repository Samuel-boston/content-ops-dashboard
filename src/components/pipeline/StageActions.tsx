"use client";

import Link from "next/link";
import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { ClaimDialog, EtaBadge, NudgeButton } from "@/components/pipeline/Eta";
import { ReturnToBay } from "@/components/pipeline/ReturnToBay";
import { StageBack } from "@/components/pipeline/StageBack";
import { ParkButton } from "@/components/pipeline/ParkButton";
import {
  IconCheck,
  IconChevronDown,
  IconClock,
  IconFile,
  IconRevisions,
  IconSend,
} from "@/components/ui/icons";
import {
  approveAction,
  markPostedAction,
  requestRevisionsAction,
  submitForReviewAction,
} from "@/app/pipeline-actions";
import type { Profile, Video } from "@/lib/types";

function Primary({
  children,
  onClick,
  tone = "accent",
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "accent" | "ok" | "warn";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition ${
        tone === "ok"
          ? "bg-ok hover:brightness-110"
          : tone === "warn"
            ? "bg-stage-revisions hover:brightness-110"
            : "bg-accent hover:bg-accent-hi"
      }`}
    >
      {children}
    </button>
  );
}

function Secondary({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 transition hover:bg-hover hover:text-ink"
    >
      {children}
    </button>
  );
}

/**
 * The one thing you're meant to do next, given who you are and where the video
 * is. Everything else stays out of the way — the point of the pipeline is that
 * at any moment exactly one person is holding the ball.
 */
export function StageActions({
  video,
  viewer,
  overdue = false,
}: {
  video: Video;
  viewer: Profile;
  overdue?: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [, startTransition] = useTrackedTransition();
  const [claim, setClaim] = useState<null | "claim" | "eta">(null);
  const [approveMenu, setApproveMenu] = useState(false);

  const isManager = viewer.role !== "editor";
  const mine = video.assigned_editor_id === viewer.id;

  const run = (fn: () => Promise<{ error?: string } | void>, ok: string) =>
    startTransition(async () => {
      const res = await fn();
      if (res && "error" in res && res.error) toast.error(res.error);
      else {
        toast.success(ok);
        router.refresh();
      }
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Not happening now? Shelve it rather than leaving it to pad the counts. */}
      {isManager && video.status !== "posted" ? (
        <ParkButton videoId={video.id} parked={Boolean(video.parked_at)} compact />
      ) : null}

      {/* Undo a stage move — every forward step here is one click, so every
          one of them is a misclick waiting to happen. */}
      {isManager ? <StageBack videoId={video.id} status={video.status} compact /> : null}

      {/* The client can pull work back from whoever has it — reassigning by
          hand meant clearing the editor and the stale ETA separately. */}
      {isManager && video.assigned_editor_id && video.status !== "posted" ? (
        <ReturnToBay videoId={video.id} mine={false} compact />
      ) : null}

      {/* ---------------- Editor ---------------- */}
      {!isManager ? (
        <>
          {video.status === "ready_to_edit" ? (
            <Primary onClick={() => setClaim("claim")}>
              <IconClock size={13} />
              Take it on
            </Primary>
          ) : null}

          {mine && (video.status === "in_progress" || video.status === "revisions") ? (
            <>
              <Primary onClick={() => run(() => submitForReviewAction(video.id), "Sent for review.")}>
                <IconSend size={13} />
                Submit for review
              </Primary>
              <EtaBadge etaAt={video.eta_at} stage={video.eta_stage} overdue={overdue} />
              <Secondary onClick={() => setClaim("eta")}>
                {video.eta_at ? "Change ETA" : "Set an ETA"}
              </Secondary>
            </>
          ) : null}

          {mine && video.status === "awaiting_variants" ? (
            <>
              <Primary onClick={() => run(() => submitForReviewAction(video.id), "Variants sent.")}>
                <IconSend size={13} />
                Submit variants
              </Primary>
              <EtaBadge etaAt={video.eta_at} stage={video.eta_stage} overdue={overdue} />
              <Secondary onClick={() => setClaim("eta")}>
                {video.eta_at ? "Change ETA" : "Set an ETA"}
              </Secondary>
            </>
          ) : null}
        </>
      ) : null}

      {/* ---------------- Client ---------------- */}
      {isManager ? (
        <>
          {(video.status === "ideation" || video.status === "scripting") ? (
            <Link
              href={`/videos/${video.id}/script`}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hi"
            >
              <IconFile size={13} />
              Open the script
            </Link>
          ) : null}

          {video.status === "in_review" || video.status === "final_review" ? (
            <>
              <Primary
                tone="warn"
                onClick={() => run(() => requestRevisionsAction(video.id), "Sent back for revisions.")}
              >
                <IconRevisions size={13} />
                Request revisions
              </Primary>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setApproveMenu((v) => !v)}
                  className="flex items-center gap-1.5 rounded-lg bg-ok px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110"
                >
                  <IconCheck size={13} />
                  Approve
                  <IconChevronDown size={11} />
                </button>
                {approveMenu ? (
                  <>
                    <span className="fixed inset-0 z-20" onClick={() => setApproveMenu(false)} />
                    <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-line bg-raised py-1 shadow-xl">
                      <button
                        type="button"
                        onClick={() => {
                          setApproveMenu(false);
                          run(() => approveAction(video.id), "Approved.");
                        }}
                        className="block w-full px-3 py-2 text-left text-xs hover:bg-hover"
                      >
                        <span className="block font-medium">Approve</span>
                        <span className="block text-[11px] text-ink-3">
                          {video.needs_variants
                            ? "Goes to Awaiting Variants — the script has more than one hook."
                            : "Goes straight to Ready to Post."}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setApproveMenu(false);
                          run(() => approveAction(video.id, true), "Approved — variants needed.");
                        }}
                        className="block w-full px-3 py-2 text-left text-xs hover:bg-hover"
                      >
                        <span className="block font-medium">Approve — needs hook variants</span>
                        <span className="block text-[11px] text-ink-3">
                          Force it through Awaiting Variants.
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setApproveMenu(false);
                          run(() => approveAction(video.id, false), "Approved — no variants.");
                        }}
                        className="block w-full px-3 py-2 text-left text-xs hover:bg-hover"
                      >
                        <span className="block font-medium">Approve — no variants needed</span>
                        <span className="block text-[11px] text-ink-3">
                          Skip straight to Ready to Post.
                        </span>
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </>
          ) : null}

          {video.status === "ready_to_post" ? (
            <Primary tone="ok" onClick={() => run(() => markPostedAction(video.id), "Marked as posted.")}>
              <IconCheck size={13} />
              Mark as posted
            </Primary>
          ) : null}

          {/* Waiting on an editor — show the promise and let them chase it. */}
          {(["in_progress", "revisions", "awaiting_variants"] as string[]).includes(
            video.status
          ) ? (
            <>
              <EtaBadge etaAt={video.eta_at} stage={video.eta_stage} overdue={overdue} />
              <NudgeButton videoId={video.id} />
            </>
          ) : null}
        </>
      ) : null}

      <ClaimDialog
        open={claim !== null}
        mode={claim ?? "claim"}
        videoId={video.id}
        title={video.title}
        currentEta={video.eta_at}
        onClose={() => setClaim(null)}
      />
    </div>
  );
}
