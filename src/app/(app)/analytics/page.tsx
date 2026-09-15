import { requireRole } from "@/lib/auth";
import { hookPerformance, insightRows, trialInsights } from "@/app/analytics-actions";
import { TrialPerformance } from "@/components/analytics/TrialPerformance";
import { listTaxonomyCustoms } from "@/app/actions";
import { getWorkspaceSettings, integrationStatus } from "@/lib/workspace";
import { taxonomyOptions } from "@/lib/taxonomy";
import { AnalyticsView } from "@/components/analytics/AnalyticsView";
import { RefreshMetricsButton } from "@/components/RefreshMetricsButton";

export default async function AnalyticsPage() {
  // Role-gated, not just hidden from the editor nav: this is the client's
  // performance data, and "not linked" is not the same as "not reachable".
  const viewer = await requireRole("owner", "admin");

  const [{ rows, editors }, hooks, trials, customs, settings] = await Promise.all([
    insightRows(),
    hookPerformance(),
    trialInsights(),
    listTaxonomyCustoms(),
    getWorkspaceSettings(),
  ]);

  const integrations = integrationStatus(settings);
  const isManager = viewer.role !== "editor";
  const custom = (kind: "content_pillar" | "format" | "platform") =>
    customs.filter((c) => c.kind === kind).map((c) => c.value);

  const withNumbers = rows.filter((r) => r.views > 0).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Analytics</h1>
          <p className="text-sm text-ink-2">
            {rows.length} posted · {withNumbers} with Instagram numbers attached
          </p>
        </div>
        {isManager ? <RefreshMetricsButton /> : null}
      </div>

      {!integrations.instagram ? (
        <p className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-xs leading-relaxed text-warn">
          Instagram isn&rsquo;t connected yet, so nothing here has real numbers behind it. Connect
          it in Settings → Integrations and the whole page fills in.
        </p>
      ) : null}

      <TrialPerformance groups={trials} />

      <AnalyticsView
        rows={rows}
        editors={editors}
        pillars={taxonomyOptions("content_pillar", custom("content_pillar"), [])}
        formats={taxonomyOptions("format", custom("format"), [])}
        platforms={taxonomyOptions("platform", custom("platform"), [])}
        hooks={hooks}
      />
    </div>
  );
}
