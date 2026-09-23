import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listEditors, listReadyToEdit, listTaxonomyCustoms } from "@/app/actions";
import { taxonomyOptions } from "@/lib/taxonomy";
import { QueueFilters } from "@/components/QueueFilters";
import { Pager } from "@/components/Pager";
import { ClaimButton } from "@/components/editor/ClaimButton";
import { AssignSelect } from "@/components/AssignSelect";
import { Chip, PriorityPill } from "@/components/badges";
import { CreateVideoButton } from "@/components/CreateVideoButton";
import { IconCheck, IconFile, IconLayers } from "@/components/ui/icons";
import { dayMonth } from "@/lib/format";

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * The Editing Bay — everything filmed, cut-ready, and not yet spoken for.
 *
 * Editors get one control per row: take it. The client gets the full assign
 * dropdown, because handing work to a specific person is their call. Keeping
 * those two controls apart is what stops an editor mis-assigning to a
 * colleague, rather than relying on an error message after the fact.
 */
export default async function EditingBayPage({ searchParams }: PageProps<"/editing-bay">) {
  const sp = await searchParams;
  const viewer = await requireUser();
  const isManager = viewer.role === "owner" || viewer.role === "admin";

  const filters = {
    search: first(sp.search),
    pillar: first(sp.pillar),
    format: first(sp.format),
    platform: first(sp.platform),
    page: Number(first(sp.page) ?? 1),
  };

  const [{ rows, total, page, pageSize }, editors, customs] = await Promise.all([
    listReadyToEdit(filters),
    listEditors(),
    listTaxonomyCustoms(),
  ]);

  const editorLite = editors.map((e) => ({ id: e.id, full_name: e.full_name, email: e.email }));
  const customBy = (kind: "content_pillar" | "format" | "platform") =>
    customs.filter((c) => c.kind === kind).map((c) => c.value);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Editing Bay</h1>
          <p className="text-sm text-ink-2">
            {total === 0
              ? "Empty — nothing filmed and waiting."
              : `${total} video${total === 1 ? "" : "s"} filmed and waiting to be cut.`}
            {!isManager && total > 0 ? " Highest priority first." : ""}
          </p>
        </div>
        {isManager ? <CreateVideoButton viewerId={viewer.id} /> : null}
      </div>

      {!isManager ? (
        <p className="rounded-lg border border-line bg-card px-3 py-2 text-xs text-ink-3">
          Taking one asks for a delivery day — by the end of that day. It doesn&rsquo;t have to be
          exact; it&rsquo;s so the client can plan around you, and you can change it later.
        </p>
      ) : null}

      <QueueFilters
        pillarOptions={taxonomyOptions("content_pillar", customBy("content_pillar"))}
        formatOptions={taxonomyOptions("format", customBy("format"))}
        platformOptions={taxonomyOptions("platform", customBy("platform"))}
      />

      <div className="overflow-hidden rounded-xl border border-line bg-app">
        {rows.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <span className="text-ok">
              <IconLayers size={18} />
            </span>
            <p className="mt-2 text-sm text-ink-2">Nothing in the bay.</p>
            <p className="mt-1 text-xs text-ink-3">
              {isManager ? "More needs filming." : "The client needs to film more — nothing to pick up."}
            </p>
          </div>
        ) : (
          rows.map((v) => (
            <div
              key={v.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3 last:border-0 hover:bg-hover/40"
            >
              <PriorityPill priority={v.priority} />
              <Link
                href={`/videos/${v.id}`}
                className="min-w-[150px] flex-1 truncate text-sm font-medium hover:underline"
              >
                {v.title}
              </Link>

              <span className="hidden flex-wrap gap-1 sm:flex">
                {[...(v.formats ?? []), ...(v.platforms ?? [])].slice(0, 2).map((t) => (
                  <Chip key={t}>{t}</Chip>
                ))}
              </span>

              {v.script_body || v.script_hooks?.length ? (
                <span
                  className="flex items-center gap-1 text-[11px] text-ink-3"
                  title="A script is attached"
                >
                  <IconFile size={11} />
                  Script
                </span>
              ) : null}

              {v.post_date ? (
                <span className="text-[11px] text-ink-3">posts {dayMonth(v.post_date)}</span>
              ) : null}

              {v.assigned_editor ? (
                <span className="flex items-center gap-1 text-[11px] text-ok">
                  <IconCheck size={11} />
                  {v.assigned_editor.full_name}
                </span>
              ) : null}

              {isManager ? (
                <AssignSelect
                  videoId={v.id}
                  videoTitle={v.title}
                  currentEta={v.eta_at}
                  currentEditorId={v.assigned_editor_id}
                  currentEditorName={v.assigned_editor?.full_name ?? null}
                  editors={editorLite}
                  canAssignOthers
                  meId={viewer.id}
                />
              ) : (
                <ClaimButton
                  videoId={v.id}
                  videoTitle={v.title}
                  mine={v.assigned_editor_id === viewer.id}
                  currentEta={v.eta_at}
                />
              )}
            </div>
          ))
        )}
      </div>

      <Pager page={page} pageSize={pageSize} total={total} />
    </div>
  );
}
