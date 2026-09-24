"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { IconTrash } from "@/components/ui/icons";
import {
  addSuggestedPostAction,
  addTopPostsAction,
  deleteTopPostAction,
  previewPastedPostsAction,
  updateTopPostAction,
  type SuggestedPost,
} from "@/app/top-posts-actions";
import type { TopPost } from "@/lib/top-posts";
import type { TopPostInput } from "@/lib/top-posts-parse";
import { fmtViews } from "@/lib/perf-stats";
import { parseViews } from "@/lib/top-posts-parse";

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  x: "X",
  other: "Other",
};

const AI_PROMPT = `Find the top-performing short-form posts in my niche from the last 90 days: the ones that got far more views than that account usually gets. For each, give me the topic, the exact opening hook, the view count, the link, the platform and the creator. Then show me the list and wait: I will tell you which ones are good. For the ones I approve, add them to my Content Ops dashboard's Top posts list using the add_top_posts tool (if the connector isn't available, give them to me as a table with the columns: Views | Topic | Hook | Link | Platform | Creator).`;

/** The curated list, plus every way of adding to it. */
export function TopPostsBoard({
  posts,
  suggestions,
  canEdit,
}: {
  posts: TopPost[];
  suggestions: SuggestedPost[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTrackedTransition();
  const [q, setQ] = useState("");
  const [source, setSource] = useState<"all" | "own" | "inspiration">("all");
  const [platform, setPlatform] = useState("");
  const [adding, setAdding] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [preview, setPreview] = useState<TopPostInput[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ topic: "", hook: "", views: "", link: "", creator: "", notes: "", source: "inspiration" as "own" | "inspiration" });

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return posts.filter(
      (p) =>
        (source === "all" || p.source === source) &&
        (!platform || p.platform === platform) &&
        (!needle || [p.topic, p.hook, p.creator, p.notes].some((f) => f?.toLowerCase().includes(needle)))
    );
  }, [posts, q, source, platform]);
  const platforms = useMemo(() => [...new Set(posts.map((p) => p.platform).filter(Boolean))] as string[], [posts]);

  const cls = "w-full rounded-lg border border-line bg-raised px-2.5 py-1.5 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none";
  const btn = "rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50";

  function run(fn: () => Promise<{ error?: string; added?: number; skipped?: number } | { ok: true }>, done?: (r: { added?: number; skipped?: number }) => string) {
    startTransition(async () => {
      const res = await fn();
      if ("error" in res && res.error) return toast.error(res.error);
      if (done) toast.success(done(res as { added?: number; skipped?: number }));
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-ink-2">
          What has worked: the views, the topic, the hook and the link. Borrow hooks from here when you write.
        </p>
        {canEdit ? (
          <>
            <button type="button" onClick={() => setAdding((v) => !v)} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hi">
              Add a post
            </button>
            <button type="button" onClick={() => setPasteOpen((v) => !v)} className={btn}>
              Paste a list
            </button>
          </>
        ) : null}
      </div>

      {adding && canEdit ? (
        <form
          className="grid gap-2 rounded-xl border border-line bg-card p-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                addTopPostsAction([
                  { topic: form.topic, hook: form.hook || null, views: parseViews(form.views), link: form.link || null, creator: form.creator || null, notes: form.notes || null, source: form.source },
                ]),
              () => "Added."
            );
            setForm({ topic: "", hook: "", views: "", link: "", creator: "", notes: "", source: "inspiration" });
            setAdding(false);
          }}
        >
          <input required value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="Topic — what it was about" className={`${cls} sm:col-span-2`} />
          <input value={form.hook} onChange={(e) => setForm({ ...form, hook: e.target.value })} placeholder="The hook — the opening line" className={`${cls} sm:col-span-2`} />
          <input value={form.views} onChange={(e) => setForm({ ...form, views: e.target.value })} placeholder="Views (e.g. 1.2M or 350k)" className={cls} />
          <input value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="Link to the post" className={cls} />
          <input value={form.creator} onChange={(e) => setForm({ ...form, creator: e.target.value })} placeholder="Creator / account (optional)" className={cls} />
          <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value as "own" | "inspiration" })} className={cls} aria-label="Whose post">
            <option value="inspiration">Someone else&rsquo;s (inspiration)</option>
            <option value="own">One of ours</option>
          </select>
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Why it worked (optional)" className={`${cls} sm:col-span-2`} />
          <div className="sm:col-span-2">
            <button disabled={pending || !form.topic.trim()} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-hi disabled:opacity-50">
              Add to the list
            </button>
          </div>
        </form>
      ) : null}

      {pasteOpen && canEdit ? (
        <div className="space-y-2 rounded-xl border border-line bg-card p-3">
          <p className="text-xs text-ink-3">
            Paste a table from a spreadsheet, a list from ChatGPT or Claude, or loose lines. I&rsquo;ll pick out the views, topic, hook and link. Check what I understood before it&rsquo;s added.
          </p>
          <textarea
            value={pasted}
            onChange={(e) => {
              setPasted(e.target.value);
              setPreview(null);
            }}
            rows={6}
            placeholder={"Views | Topic | Hook | Link\n1.2M | Burnout signs | Nobody tells you this | https://…"}
            className={`${cls} font-mono text-xs`}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending || !pasted.trim()}
              onClick={() =>
                startTransition(async () => {
                  const rows = await previewPastedPostsAction(pasted);
                  setPreview(rows);
                  if (!rows.length) toast.error("I couldn't find any posts in that.");
                })
              }
              className={btn}
            >
              Read it
            </button>
            {preview?.length ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(
                    () => addTopPostsAction(preview),
                    (r) => `Added ${r.added}${r.skipped ? `, skipped ${r.skipped} already on the list` : ""}.`
                  )
                }
                className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-white hover:bg-accent-hi"
              >
                Add these {preview.length}
              </button>
            ) : null}
          </div>
          {preview?.length ? (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-left text-xs">
                <thead className="bg-raised text-ink-3">
                  <tr>
                    <th className="px-2 py-1.5">Views</th>
                    <th className="px-2 py-1.5">Topic</th>
                    <th className="px-2 py-1.5">Hook</th>
                    <th className="px-2 py-1.5">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="px-2 py-1.5 tabular-nums">{fmtViews(r.views)}</td>
                      <td className="px-2 py-1.5">{r.topic}</td>
                      <td className="px-2 py-1.5 text-ink-2">{r.hook ?? "—"}</td>
                      <td className="max-w-[12rem] truncate px-2 py-1.5 text-ink-3">{r.link ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      {canEdit && suggestions.length ? (
        <section className="rounded-xl border border-line bg-card p-3">
          <h2 className="text-sm font-semibold">Your own best posts, not on the list yet</h2>
          <p className="mb-2 text-[11px] text-ink-3">From the numbers in the dashboard. One click adds it.</p>
          <ul className="space-y-1.5">
            {suggestions.map((s) => (
              <li key={s.videoId} className="flex items-center gap-2 text-sm">
                <span className="w-14 shrink-0 tabular-nums text-ink-2">{fmtViews(s.views)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {s.topic}
                  {s.hook ? <span className="text-ink-3"> — “{s.hook}”</span> : null}
                </span>
                <button type="button" disabled={pending} onClick={() => run(() => addSuggestedPostAction(s), () => "Added.")} className={btn}>
                  Add
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search topics, hooks, creators…" className={`${cls} max-w-xs`} />
        <div className="flex overflow-hidden rounded-lg border border-line text-xs" role="group" aria-label="Whose posts">
          {(
            [
              ["all", "All"],
              ["own", "Ours"],
              ["inspiration", "Inspiration"],
            ] as const
          ).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setSource(v)} className={`px-3 py-1.5 ${source === v ? "bg-accent text-white" : "text-ink-2 hover:bg-hover"}`}>
              {label}
            </button>
          ))}
        </div>
        {platforms.length > 1 ? (
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform" className="rounded-lg border border-line bg-raised px-2 py-1.5 text-xs">
            <option value="">All platforms</option>
            {platforms.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABEL[p] ?? p}
              </option>
            ))}
          </select>
        ) : null}
        <span className="text-xs text-ink-3">{shown.length} post{shown.length === 1 ? "" : "s"}</span>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-ink-3">
          {posts.length === 0
            ? canEdit
              ? "Nothing here yet. Add a post, paste a list, or ask ChatGPT or Claude to find some."
              : "Nothing here yet."
            : "Nothing matches."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-raised text-[11px] uppercase tracking-wider text-ink-3">
              <tr>
                <th className="px-3 py-2">Views</th>
                <th className="px-3 py-2">Topic</th>
                <th className="px-3 py-2">Hook</th>
                <th className="px-3 py-2">Where</th>
                <th className="px-3 py-2">Link</th>
                {canEdit ? <th className="px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} className="border-t border-line align-top">
                  <td className="px-3 py-2.5 font-semibold tabular-nums">{fmtViews(p.views)}</td>
                  <td className="px-3 py-2.5">
                    {editing === p.id ? (
                      <input
                        autoFocus
                        defaultValue={p.topic}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          setEditing(null);
                          if (v && v !== p.topic) run(() => updateTopPostAction(p.id, { topic: v }));
                        }}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                        className={cls}
                      />
                    ) : (
                      <button type="button" disabled={!canEdit} onClick={() => setEditing(p.id)} className="text-left">
                        {p.topic}
                      </button>
                    )}
                    {p.notes ? <p className="mt-0.5 text-[11px] text-ink-3">{p.notes}</p> : null}
                  </td>
                  <td className="max-w-[18rem] px-3 py-2.5 text-ink-2">{p.hook ? `“${p.hook}”` : "—"}</td>
                  <td className="px-3 py-2.5 text-xs text-ink-2">
                    {PLATFORM_LABEL[p.platform ?? ""] ?? p.platform ?? "—"}
                    {p.creator ? <span className="block text-ink-3">{p.creator}</span> : null}
                    <span className={`mt-1 inline-block rounded-full border px-1.5 py-0.5 text-[9px] ${p.source === "own" ? "border-accent/40 text-accent-hi" : "border-line text-ink-3"}`}>
                      {p.source === "own" ? "ours" : "inspiration"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {p.link ? (
                      <a href={p.link} target="_blank" rel="noopener noreferrer" className="text-accent-hi hover:underline">
                        Open ↗
                      </a>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                  {canEdit ? (
                    <td className="px-3 py-2.5 text-right">
                      <button type="button" disabled={pending} onClick={() => run(() => deleteTopPostAction(p.id), () => "Removed.")} title="Remove" aria-label="Remove" className="rounded p-1 text-ink-3 hover:text-danger">
                        <IconTrash size={13} />
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit ? (
        <section className="rounded-xl border border-line bg-card p-3">
          <h2 className="text-sm font-semibold">Let ChatGPT or Claude find them</h2>
          <p className="mb-2 text-[11px] text-ink-3">
            Copy this into ChatGPT or Claude. With the Content Ops connector (Connect AI in the avatar menu) it can add the ones you approve straight to this list.
          </p>
          <textarea readOnly value={AI_PROMPT} rows={4} onFocus={(e) => e.currentTarget.select()} className={`${cls} font-mono text-xs`} />
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(AI_PROMPT).then(() => toast.success("Copied."), () => toast.error("Select the text and copy it by hand."));
            }}
            className={`${btn} mt-2`}
          >
            Copy the prompt
          </button>
        </section>
      ) : null}
    </div>
  );
}
