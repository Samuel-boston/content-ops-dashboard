import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { listEditors, listTaxonomyCustoms } from "@/app/actions";
import { taxonomyOptions } from "@/lib/taxonomy";
import { ArchiveFilters } from "@/components/ArchiveFilters";
import { CalendarMonth } from "@/components/CalendarMonth";
import { Chip } from "@/components/badges";
import { shiftMonth } from "@/lib/calendar";
import type { VideoWithEditor } from "@/lib/types";

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function ArchivePage({ searchParams }: PageProps<"/archive">) {
  await requireUser();
  const sp = await searchParams;
  const supabase = await supabaseServer();

  const view = first(sp.view) === "calendar" ? "calendar" : "list";
  const search = first(sp.search);
  const format = first(sp.format);
  const pillar = first(sp.pillar);
  const editorId = first(sp.editor);

  const [customs, editors] = await Promise.all([listTaxonomyCustoms(), listEditors()]);

  let q = supabase
    .from("videos")
    .select("*, assigned_editor:profiles!videos_assigned_editor_id_fkey (id, full_name, email)")
    .eq("status", "posted")
    .order("post_date", { ascending: false, nullsFirst: false });

  if (search) q = q.ilike("title", `%${search}%`);
  if (format) q = q.contains("formats", [format]);
  if (pillar) q = q.contains("content_pillars", [pillar]);
  if (editorId) q = q.eq("assigned_editor_id", editorId);

  const { data } = await q;
  const rows = (data as VideoWithEditor[]) ?? [];

  // Calendar view navigates months; list view shows everything matching.
  const now = new Date();
  const year = Number(first(sp.y) ?? now.getFullYear());
  const month = Number(first(sp.m) ?? now.getMonth());
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const monthLabel = new Date(year, month, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });

  const byMonth = new Map<string, VideoWithEditor[]>();
  for (const v of rows) {
    const key = v.post_date ? v.post_date.slice(0, 7) : "undated";
    byMonth.set(key, [...(byMonth.get(key) ?? []), v]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Archive</h1>
          <p className="text-sm text-ink-2">
            Everything that&rsquo;s posted — {rows.length} video{rows.length === 1 ? "" : "s"}.
            Browse by date, or filter by format, pillar and editor.
          </p>
        </div>
      </div>

      <ArchiveFilters
        view={view}
        pillarOptions={taxonomyOptions(
          "content_pillar",
          customs.filter((c) => c.kind === "content_pillar").map((c) => c.value)
        )}
        formatOptions={taxonomyOptions(
          "format",
          customs.filter((c) => c.kind === "format").map((c) => c.value)
        )}
        editors={editors.map((e) => ({ id: e.id, name: e.full_name || e.email }))}
      />

      {view === "calendar" ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{monthLabel}</h2>
            <div className="flex gap-1 text-sm">
              <ArchiveMonthLink sp={sp} y={prev.year} m={prev.month} label="← Prev" />
              <ArchiveMonthLink sp={sp} y={now.getFullYear()} m={now.getMonth()} label="Today" />
              <ArchiveMonthLink sp={sp} y={next.year} m={next.month} label="Next →" />
            </div>
          </div>
          <CalendarMonth year={year} month={month} />
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-card px-4 py-10 text-center text-sm text-ink-3">
          Nothing archived yet. Videos land here the moment they&rsquo;re marked Posted.
        </p>
      ) : (
        <div className="space-y-5">
          {[...byMonth.entries()].map(([key, list]) => (
            <section key={key}>
              <h2 className="mb-1.5 text-sm font-semibold text-ink-2">
                {key === "undated"
                  ? "No post date"
                  : new Date(`${key}-01T00:00:00`).toLocaleString(undefined, {
                      month: "long",
                      year: "numeric",
                    })}
                <span className="ml-2 font-mono text-xs font-normal text-ink-3">
                  {list.length}
                </span>
              </h2>
              <div className="overflow-hidden rounded-xl border border-line bg-app">
                {list.map((v) => (
                  <div
                    key={v.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line px-3 py-3 last:border-0 hover:bg-hover/40 sm:px-4"
                  >
                    <Link
                      href={`/videos/${v.id}`}
                      className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5"
                    >
                      <span className="w-20 shrink-0 font-mono text-xs text-ink-3">
                        {v.post_date
                          ? new Date(v.post_date).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })
                          : "—"}
                      </span>
                      <span className="min-w-[150px] flex-1 font-medium">{v.title}</span>
                      <div className="hidden flex-wrap gap-1 sm:flex">
                        {[...v.platforms, ...v.formats].slice(0, 3).map((t) => (
                          <Chip key={t}>{t}</Chip>
                        ))}
                      </div>
                      <span className="text-xs text-ink-3">
                        {v.assigned_editor?.full_name ?? "—"}
                      </span>
                    </Link>

                    {/*
                      The whole point of the archive: once a video is posted the
                      media is swept to Drive and the dashboard keeps the links.
                      These have to sit outside the row's own Link — an anchor
                      inside an anchor is invalid and the browser drops it, which
                      is why this only ever showed the word "Drive" before.
                    */}
                    <span className="flex shrink-0 items-center gap-1.5">
                      <ArchiveLink href={v.drive_file_url} label="Edit" />
                      <ArchiveLink href={v.raw_footage_url} label="Raw" />
                      {!v.drive_file_url && !v.raw_footage_url ? (
                        <span className="text-[10px] text-ink-3">no files</span>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** One file link, or nothing when that file was never captured. */
function ArchiveLink({ href, label }: { href: string | null; label: string }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-md border border-line px-2 py-1 text-[10px] text-ink-2 transition hover:border-accent hover:text-ink"
    >
      {label} ↗
    </a>
  );
}

function ArchiveMonthLink({
  sp,
  y,
  m,
  label,
}: {
  sp: Record<string, string | string[] | undefined>;
  y: number;
  m: number;
  label: string;
}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "y" || k === "m") continue;
    const val = Array.isArray(v) ? v[0] : v;
    if (val) params.set(k, val);
  }
  params.set("view", "calendar");
  params.set("y", String(y));
  params.set("m", String(m));
  return (
    <Link
      href={`/archive?${params.toString()}`}
      className="rounded-md border border-line-strong px-2 py-1 hover:bg-hover"
    >
      {label}
    </Link>
  );
}
