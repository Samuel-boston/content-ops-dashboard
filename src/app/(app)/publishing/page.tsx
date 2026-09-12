import { requireRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { listPublishJobs } from "@/app/publishing-actions";
import { getWorkspaceSettings, integrationStatus } from "@/lib/workspace";
import { PublishingBoard } from "@/components/PublishingBoard";
import type { VideoWithEditor } from "@/lib/types";

export default async function PublishingPage() {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();

  const [jobs, settings, { data: approved }] = await Promise.all([
    listPublishJobs(),
    getWorkspaceSettings(),
    supabase
      .from("videos")
      .select("*, assigned_editor:profiles!videos_assigned_editor_id_fkey (id, full_name, email)")
      .in("status", ["approved", "posted"])
      .order("post_date", { ascending: true, nullsFirst: true }),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Publishing</h1>
        <p className="text-sm text-ink-2">
          Schedule or post approved videos straight to Instagram — same Graph API connection as
          analytics.
        </p>
      </div>
      {!integrationStatus(settings).instagram ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-3 text-sm text-ink-3">
          Instagram publishing isn&rsquo;t connected. Add the Graph API token (with publishing
          permissions) in Settings → Integrations. You can still queue jobs now — they&rsquo;ll run once
          it&rsquo;s connected.
        </p>
      ) : null}
      <PublishingBoard
        jobs={jobs}
        candidates={(approved as VideoWithEditor[]) ?? []}
      />
    </div>
  );
}
