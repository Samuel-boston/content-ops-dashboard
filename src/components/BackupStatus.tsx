"use client";

import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { backupNowAction, type LastBackup } from "@/app/settings-extra-actions";
import { IconCheck, IconSparkles } from "@/components/ui/icons";
import { shortDate } from "@/lib/format";

/**
 * An independent, off-Supabase copy of every content table (not the
 * integration credentials — those stay out of a file that lands in a more
 * widely shared Drive folder), refreshed daily by the cron job and kickable
 * by hand here. The point isn't that Supabase is expected to fail — it's
 * that "everything's saved somewhere else too" shouldn't depend on trusting
 * that it never does.
 */
export function BackupStatus({ last, driveConfigured }: { last: LastBackup | null; driveConfigured: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTrackedTransition();
  const [running, setRunning] = useState(false);

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Backups</h2>
      <div className="rounded-xl border border-line bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-ink-2">
            {!driveConfigured ? (
              "Connect Google Drive above to turn this on."
            ) : !last ? (
              "No backup has run yet — the daily job or the button below will start one."
            ) : last.ok ? (
              <>
                Last backup {shortDate(last.at)} · {last.rows ?? 0} rows across every table (except
                integration credentials).
              </>
            ) : (
              <>Last attempt {shortDate(last.at)} failed: {last.error}</>
            )}
          </p>
          {last?.link ? (
            <a
              href={last.link}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs text-accent-hi hover:underline"
            >
              Open in Drive
            </a>
          ) : null}
          <button
            type="button"
            disabled={!driveConfigured || running}
            onClick={() => {
              setRunning(true);
              startTransition(async () => {
                const res = await backupNowAction();
                setRunning(false);
                if (res.ok) {
                  toast.success(`Backed up ${res.rows ?? 0} rows.`);
                  router.refresh();
                } else {
                  toast.error(res.error ?? "Backup failed.");
                }
              });
            }}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-medium text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50"
          >
            {running ? (
              <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-ink-3 border-t-transparent" />
            ) : last?.ok ? (
              <IconCheck size={12} />
            ) : (
              <IconSparkles size={12} />
            )}
            {running ? "Backing up…" : "Back up now"}
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-ink-3">
          Runs on its own every day too — a full export of videos, scripts, comments, references
          and everything else to a &ldquo;Backups&rdquo; folder in the same Drive account,
          independent of Supabase. Raw footage and posted videos are already safe on
          Drive/Cloudflare, this covers the database itself.
        </p>
      </div>
    </section>
  );
}
