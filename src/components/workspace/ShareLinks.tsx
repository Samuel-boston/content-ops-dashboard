"use client";

import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { QR } from "@/components/ui/QR";
import { IconCamera, IconFolder, IconLink, IconTrash, IconX } from "@/components/ui/icons";
import { createGuestLinkAction, revokeGuestLinkAction } from "@/app/guest-actions";
import { shortDate } from "@/lib/format";
import type { GuestLink } from "@/lib/types";

/**
 * Three kinds of link off the same table:
 *   review — someone outside the team watches and comments, no account
 *   upload — a phone sends footage in, scanned from the QR code
 *   assets — the reverse: a phone gets a downloadable package (brief,
 *            footage, references) — for a trial/freelance editor with no
 *            dashboard login
 */
export function ShareLinks({
  videoId,
  links,
  canManage,
}: {
  videoId: string;
  links: GuestLink[];
  canManage: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [, startTransition] = useTrackedTransition();
  const [showQr, setShowQr] = useState<{ url: string; purpose: "upload" | "assets" } | null>(null);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const urlFor = (t: string) => `${origin}/g/${t}`;

  const active = links.filter((l) => !l.revoked);
  const uploadLink = active.find((l) => l.purpose === "upload");
  const assetsLink = active.find((l) => l.purpose === "assets");

  const create = (purpose: "review" | "upload" | "assets") =>
    startTransition(async () => {
      const res = await createGuestLinkAction({ videoId, purpose });
      if (res && "error" in res && res.error) toast.error(res.error);
      else {
        if (purpose !== "review" && res && "token" in res && res.token) {
          setShowQr({ url: urlFor(res.token), purpose });
        }
        toast.success(
          purpose === "upload" ? "Upload link ready." : purpose === "assets" ? "Asset package ready." : "Review link created."
        );
        router.refresh();
      }
    });

  if (!canManage) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Share</h3>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => create("review")}
          className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-2 hover:border-accent hover:text-ink"
        >
          <IconLink size={12} />
          Review link
        </button>
        <button
          type="button"
          onClick={() =>
            uploadLink
              ? setShowQr({ url: urlFor(uploadLink.token), purpose: "upload" })
              : create("upload")
          }
          className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-2 hover:border-accent hover:text-ink"
        >
          <IconCamera size={12} />
          Upload from phone
        </button>
        <button
          type="button"
          onClick={() =>
            assetsLink
              ? setShowQr({ url: urlFor(assetsLink.token), purpose: "assets" })
              : create("assets")
          }
          className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-2 hover:border-accent hover:text-ink"
        >
          <IconFolder size={12} />
          Send assets to phone
        </button>
      </div>

      <p className="text-[11px] leading-snug text-ink-3">
        A review link lets someone watch and comment without an account. An upload link is a QR
        code that sends footage straight in from the phone that filmed it. An assets link is the
        reverse — a QR code that hands a phone the brief, footage and references, for a trial
        editor with no login.
      </p>

      {active.length ? (
        <div className="space-y-1.5">
          {active.map((l) => (
            <div
              key={l.id}
              className="flex items-center gap-2 rounded-lg border border-line bg-card px-2.5 py-2"
            >
              <span className="text-ink-3">
                {l.purpose === "upload" ? (
                  <IconCamera size={12} />
                ) : l.purpose === "assets" ? (
                  <IconFolder size={12} />
                ) : (
                  <IconLink size={12} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] capitalize">{l.purpose} link</span>
                <span className="block text-[10px] text-ink-3">
                  made {shortDate(l.created_at)}
                  {l.expires_at ? ` · expires ${shortDate(l.expires_at)}` : ""}
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(urlFor(l.token));
                  toast.success("Link copied.");
                }}
                className="rounded-md border border-line px-2 py-1 text-[10px] text-ink-2 hover:bg-hover hover:text-ink"
              >
                Copy
              </button>
              {l.purpose === "upload" || l.purpose === "assets" ? (
                <button
                  type="button"
                  onClick={() => setShowQr({ url: urlFor(l.token), purpose: l.purpose as "upload" | "assets" })}
                  className="rounded-md border border-line px-2 py-1 text-[10px] text-ink-2 hover:bg-hover hover:text-ink"
                >
                  QR
                </button>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  startTransition(async () => {
                    const res = await revokeGuestLinkAction(l.id, videoId);
                    if (res?.error) toast.error(res.error);
                    else {
                      toast.success("Link revoked.");
                      router.refresh();
                    }
                  })
                }
                aria-label="Revoke link"
                className="rounded p-1 text-ink-3 hover:text-danger"
              >
                <IconTrash size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {showQr ? (
        <div
          role="dialog"
          aria-modal
          aria-label={showQr.purpose === "assets" ? "Scan for the asset package" : "Scan to upload"}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4"
          onClick={() => setShowQr(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs space-y-3 rounded-2xl border border-line bg-card p-5 text-center shadow-2xl"
          >
            <div className="flex items-center gap-2">
              <h2 className="flex-1 text-left text-sm font-semibold">
                {showQr.purpose === "assets" ? "Scan for the assets" : "Scan to upload"}
              </h2>
              <button
                type="button"
                onClick={() => setShowQr(null)}
                aria-label="Close"
                className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
              >
                <IconX size={14} />
              </button>
            </div>
            <div className="flex justify-center">
              <QR url={showQr.url} />
            </div>
            <p className="text-[11px] leading-snug text-ink-3">
              {showQr.purpose === "assets"
                ? "Point a phone camera at this. It opens the brief, footage and references — no login needed."
                : "Point a phone camera at this. Footage uploads straight to the editors — the phone never needs to be signed in."}
            </p>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(showQr.url);
                toast.success("Link copied.");
              }}
              className="w-full rounded-lg border border-line py-1.5 text-[11px] text-ink-2 hover:bg-hover hover:text-ink"
            >
              Copy the link instead
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
