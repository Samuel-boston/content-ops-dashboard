"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import {
  trialPostingKitAction,
  vaCancelScheduledAction,
  vaPublishAction,
  vaSaveLinkAction,
  vaSaveTrialMetricsAction,
  vaSetVariantStateAction,
  variantPhoneTokenAction,
  type PostingFeedMetrics,
  type PostingTrialItem,
} from "@/app/posting-actions";
import { IconClock } from "@/components/ui/icons";
import { QR } from "@/components/ui/QR";
import { PostComposer, type ComposerSubmit } from "@/components/posting/PostComposer";
import { SETTABLE_STATES, STATE_LABELS, STATE_TONE, type VariantState } from "@/lib/variant-state";

const field =
  "w-full rounded-md border border-line bg-raised px-2 py-1.5 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none";

const NUMBERS = ["views", "likes", "comments", "shares", "saves"] as const;

function Section({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-card p-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{title}</h3>
      {hint ? <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">{hint}</p> : null}
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

/**
 * One hook variant, everything about it in one organised place: its status, what
 * to do with it (file, QR, caption, instructions, cover), where to post it
 * (by hand, or through Instagram), and how it performed.
 *
 * Trial reels can't be read by Instagram's API, so their numbers are typed in;
 * a variant on the main feed is connected to Instagram's own numbers.
 */
export function VariantDetail({
  trial,
  feedMetrics,
  instagramConnected,
  clientName,
  onBack,
  onChanged,
}: {
  trial: PostingTrialItem;
  feedMetrics: PostingFeedMetrics | null;
  instagramConnected: boolean;
  clientName: string;
  /** When given, shows an "← All variants" link. */
  onBack?: () => void;
  /** Called after any change, so a parent that holds its own copy of the data can reload it. */
  onChanged?: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();
  const [permalink, setPermalink] = useState(trial.permalink ?? "");
  const [composing, setComposing] = useState(false);
  const [draftCaption, setDraftCaption] = useState(trial.caption ?? "");
  const [phoneUrl, setPhoneUrl] = useState<string | null>(null);
  const [m, setM] = useState({
    views: trial.views?.toString() ?? "",
    likes: trial.likes?.toString() ?? "",
    comments: trial.comments?.toString() ?? "",
    shares: trial.shares?.toString() ?? "",
    saves: trial.saves?.toString() ?? "",
  });

  const state = trial.state;
  const live = state === "trial_posted" || state === "feed_posted";
  const isCarousel = Boolean(trial.images?.length);

  const done = (msg: string) => {
    toast.success(msg);
    router.refresh();
    onChanged?.();
  };

  function setState(next: Exclude<VariantState, "scheduled_feed">) {
    startTransition(async () => {
      const res = await vaSetVariantStateAction(trial.id, next, permalink || undefined);
      if (res?.error) return toast.error(res.error);
      done(next === "feed_posted" && res.linked ? "Posted on feed — connected to its Instagram numbers." : `Status: ${STATE_LABELS[next]}.`);
    });
  }

  function getKit() {
    if (trial.images?.length) {
      trial.images.forEach((u, i) => setTimeout(() => window.open(u, "_blank", "noopener"), i * 250));
      return;
    }
    startTransition(async () => {
      const res = await trialPostingKitAction(trial.id);
      if ("error" in res) return toast.error(res.error);
      if (!res.downloadUrl) return toast.error("No downloadable file for this cut yet — ask the team.");
      if (!res.original) {
        toast.info("Heads up: this is Cloudflare's re-encoded copy, smaller than what was uploaded. Ask for the original to be re-uploaded if quality matters.");
      }
      window.open(res.downloadUrl, "_blank", "noopener");
    });
  }

  function showPhoneCode() {
    startTransition(async () => {
      const { token } = await variantPhoneTokenAction(trial.id);
      setPhoneUrl(`${window.location.origin}/api/variant/${token}`);
    });
  }

  function copyCaption() {
    if (!trial.caption) return toast.error("No caption written for this one.");
    navigator.clipboard
      .writeText(trial.caption)
      .then(() => toast.success("Caption copied."))
      .catch(() => toast.error("Couldn't copy — select it by hand."));
  }

  function publish(v: ComposerSubmit) {
    startTransition(async () => {
      const res = await vaPublishAction(trial.id, {
        whenISO: v.whenISO,
        caption: v.caption,
        coverOffsetMs: v.coverOffsetMs,
        shareToFeed: v.shareToFeed,
      });
      if (res?.error) return toast.error(res.error);
      done(res.scheduled ? "Scheduled for the feed — it'll go out by itself." : "Posted to the feed on Instagram ✓");
    });
  }

  function saveLink() {
    startTransition(async () => {
      const res = await vaSaveLinkAction(trial.id, permalink);
      if (res?.error) return toast.error(res.error);
      done(res.linked ? "Link saved — connected to its Instagram numbers." : "Link saved.");
    });
  }

  function saveNumbers() {
    startTransition(async () => {
      const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/,/g, "")));
      const res = await vaSaveTrialMetricsAction(trial.id, {
        views: num(m.views),
        likes: num(m.likes),
        comments: num(m.comments),
        shares: num(m.shares),
        saves: num(m.saves),
      });
      if (res?.error) return toast.error(res.error);
      done("Numbers saved.");
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {onBack ? (
          <button type="button" onClick={onBack} className="text-xs text-ink-3 hover:text-ink">
            ← All variants
          </button>
        ) : null}
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
          {trial.winner ? "🏆 " : ""}
          {trial.label}
        </h2>
        <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATE_TONE[state]}`}>
          {STATE_LABELS[state]}
        </span>
      </div>

      {/* Status */}
      <Section
        title="Status"
        hint="Pick where this variant is. Any status can be changed to any other, so a mistake is never stuck."
      >
        {state === "scheduled_feed" ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-sky-500/30 bg-sky-500/10 px-2.5 py-2 text-xs text-sky-300">
            <IconClock size={12} />
            Scheduled for the feed
            {trial.jobAt ? ` · ${new Date(trial.jobAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : ""}
            <span className="text-ink-3">— goes out by itself.</span>
            {trial.jobId ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await vaCancelScheduledAction(trial.jobId as string);
                    if (res?.error) toast.error(res.error);
                    else done("Taken off the schedule — it's back in To post.");
                  })
                }
                className="ml-auto rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-red-400 hover:text-red-400 disabled:opacity-50"
              >
                Cancel the schedule
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {SETTABLE_STATES.map((s) => (
            <button
              key={s}
              type="button"
              disabled={pending || state === s}
              onClick={() => setState(s as Exclude<VariantState, "scheduled_feed">)}
              className={`rounded-lg border px-2 py-2 text-xs transition ${
                state === s ? `border-transparent font-semibold ${STATE_TONE[s]}` : "border-line text-ink-2 hover:border-accent hover:text-ink"
              } disabled:cursor-default`}
            >
              {STATE_LABELS[s]}
            </button>
          ))}
        </div>
      </Section>

      {/* Brief */}
      {trial.notes || trial.variantNotes || trial.coverUrl ? (
        <Section title="Instructions">
          {trial.notes ? (
            <p className="whitespace-pre-wrap rounded-md bg-raised px-2.5 py-2 text-xs leading-relaxed text-ink-2">
              <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-ink-3">For the whole video</span>
              {trial.notes}
            </p>
          ) : null}
          {trial.variantNotes ? (
            <p className="whitespace-pre-wrap rounded-md border border-accent/30 bg-accent-ghost/40 px-2.5 py-2 text-xs leading-relaxed text-ink-2">
              <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-ink-3">About this variant</span>
              {trial.variantNotes}
            </p>
          ) : null}
          {trial.coverUrl ? (
            <a href={trial.coverUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs text-accent-hi hover:underline">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={trial.coverUrl} alt="Cover" className="h-16 w-16 rounded-md object-cover" />
              Cover image — open to save
            </a>
          ) : null}
        </Section>
      ) : null}

      {/* The file and caption */}
      <Section title="The file and caption">
        {trial.caption ? (
          <p className="whitespace-pre-wrap rounded-md bg-raised px-2.5 py-2 text-xs leading-relaxed text-ink-2">{trial.caption}</p>
        ) : (
          <p className="text-xs text-ink-3">No caption written for this one.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={getKit}
            disabled={pending}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hi disabled:opacity-50"
          >
            {isCarousel ? `Download the images (${trial.images?.length})` : "Download the video"}
          </button>
          <button
            onClick={showPhoneCode}
            disabled={pending}
            title="Scan with your phone to download it there, with the caption"
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
          >
            Send to my phone (QR)
          </button>
          <button
            onClick={copyCaption}
            disabled={pending}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
          >
            Copy caption
          </button>
        </div>
        {phoneUrl ? (
          <div className="flex items-center gap-3 rounded-lg border border-line bg-raised p-2.5">
            <QR url={phoneUrl} size={140} />
            <div className="min-w-0 text-[11px] leading-relaxed text-ink-3">
              <p className="text-ink-2">Scan with your phone.</p>
              <p>It opens a page with the download and the caption to paste. The code works for 6 hours.</p>
              <button type="button" onClick={() => setPhoneUrl(null)} className="mt-1 underline hover:text-ink-2">
                Hide
              </button>
            </div>
          </div>
        ) : null}
      </Section>

      {/* Where to post it */}
      {state !== "feed_posted" && state !== "scheduled_feed" ? (
        <Section
          title={state === "trial_posted" ? "Post it to the feed" : "Post it"}
          hint={
            state === "to_trial" ? (
              <>
                Post it from the Instagram app as a <b>trial reel</b> (Share to: Trial) — the API can&rsquo;t do trials —
                then mark it posted. Or, if it&rsquo;s going straight to the feed, use the Instagram form below.
              </>
            ) : state === "trial_posted" ? (
              <>It&rsquo;s live as a trial. If it did well, post this same cut to the main feed here.</>
            ) : (
              <>Post it to the main feed straight from here, or by hand and mark it posted.</>
            )
          }
        >
          {!isCarousel || instagramConnected ? (
            <div className="rounded-xl border border-accent/30 bg-accent-ghost/40 p-2.5">
              <button
                type="button"
                onClick={() => setComposing((v) => !v)}
                className="flex w-full items-center justify-between text-left text-xs font-medium text-ink"
              >
                <span>Post or schedule to the feed on Instagram…</span>
                <span className="text-ink-3">{composing ? "Close" : "Open"}</span>
              </button>
              {composing ? (
                <div className="mt-3">
                  <PostComposer
                    caption={draftCaption}
                    onCaptionChange={setDraftCaption}
                    connected={instagramConnected ? ["instagram"] : []}
                    emptyHint={
                      <>
                        {clientName} connects channels once in Settings → Integrations — after that they show up here to
                        post and schedule from. Until then, post it by hand and mark it posted below.
                      </>
                    }
                    isVideo={!isCarousel}
                    durationSeconds={trial.durationSeconds}
                    pending={pending}
                    onSubmit={publish}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="rounded-lg border border-line p-2.5">
            <p className="mb-1.5 text-[11px] text-ink-3">Posted it by hand? Add the link if you have it, then mark it.</p>
            <input
              value={permalink}
              onChange={(e) => setPermalink(e.target.value)}
              placeholder="Link (optional) — https://www.instagram.com/…"
              className={field}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {state !== "trial_posted" ? (
                <button
                  onClick={() => setState("trial_posted")}
                  disabled={pending}
                  className="rounded-lg bg-ok px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  ✓ Posted as trial reel
                </button>
              ) : null}
              <button
                onClick={() => setState("feed_posted")}
                disabled={pending}
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
              >
                ✓ Posted on feed
              </button>
            </div>
          </div>
        </Section>
      ) : null}

      {/* Performance */}
      {live ? (
        <Section
          title="Performance"
          hint={
            state === "trial_posted"
              ? "Trial reels can't be read by Instagram's API, so type the numbers in from the app's insights screen."
              : "Numbers for the feed post come from Instagram once its link is saved."
          }
        >
          {state === "feed_posted" && feedMetrics ? (
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              {(["views", "likes", "comments", "shares", "saves", "reach"] as const).map((k) => (
                <div key={k} className="rounded-md bg-raised px-2 py-1.5 text-center">
                  <div className="text-sm font-semibold tabular-nums">{feedMetrics[k]?.toLocaleString() ?? "—"}</div>
                  <div className="text-[10px] uppercase tracking-wide text-ink-3">{k}</div>
                </div>
              ))}
            </div>
          ) : null}
          {state === "feed_posted" && feedMetrics ? <p className="text-[11px] text-ok">From Instagram — updates automatically.</p> : null}
          {state === "trial_posted" || !feedMetrics ? (
            <>
              <div className="grid grid-cols-5 gap-1.5">
                {NUMBERS.map((k) => (
                  <label key={k} className="block">
                    <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-ink-3">{k}</span>
                    <input
                      value={m[k]}
                      onChange={(e) => setM((prev) => ({ ...prev, [k]: e.target.value }))}
                      inputMode="numeric"
                      placeholder="—"
                      className={field}
                    />
                  </label>
                ))}
              </div>
              <button
                onClick={saveNumbers}
                disabled={pending}
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
              >
                Save numbers
              </button>
            </>
          ) : null}
          <div className="flex gap-2 border-t border-line pt-2">
            <input
              value={permalink}
              onChange={(e) => setPermalink(e.target.value)}
              placeholder="Link to the post — https://www.instagram.com/…"
              className={field}
            />
            <button
              onClick={saveLink}
              disabled={pending}
              className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
            >
              Save link
            </button>
            {trial.permalink ? (
              <a href={trial.permalink} target="_blank" rel="noreferrer" className="shrink-0 self-center text-xs text-accent hover:underline">
                Open ↗
              </a>
            ) : null}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
