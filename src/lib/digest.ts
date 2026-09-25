import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STATUS_LABELS, type VideoStatus } from "@/lib/types";
import { buildPerformance, type PerformanceDigest, type PerfPost } from "@/lib/performance";
import { fmtViews } from "@/lib/perf-stats";
import { buildResearchBlock, type ResearchBlock } from "@/lib/research";

export interface DigestData {
  weekOf: string;
  posted: { title: string; date: string | null }[];
  postingNext: { title: string; date: string }[];
  waitingOnYou: { title: string; why: string }[];
  withEditors: { title: string; editor: string; eta: string | null }[];
  runwayDays: number | null;
  ideas: number;
  scripts: number;
  toFilm: number;
  /** What performed: last week, last month, and the individual outliers. */
  performance: PerformanceDigest | null;
  /** The Monday research prompt (one-click into ChatGPT or Claude) and last week's finds. */
  research: ResearchBlock | null;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Fixed month names — this string is built on the server and mailed, never hydrated. */
function short(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * Everything the client's Monday email says.
 *
 * Built from the same rows the Overview reads, so the email and the dashboard
 * can never disagree — the most corrosive thing a digest can do is describe a
 * state that isn't there when the person clicks through.
 */
export async function buildDigest(db: SupabaseClient): Promise<DigestData> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 864e5).toISOString();
  const weekAhead = new Date(now.getTime() + 7 * 864e5).toISOString().slice(0, 10);

  const { data } = await db
    .from("videos")
    .select(
      "id, title, status, post_date, posted_at, eta_at, assigned_editor_id, " +
        "assigned_editor:profiles!videos_assigned_editor_id_fkey (full_name, email)"
    )
    .is("parked_at", null);

  type Row = {
    title: string;
    status: VideoStatus;
    post_date: string | null;
    posted_at: string | null;
    eta_at: string | null;
    assigned_editor: { full_name: string | null; email: string } | null;
  };
  const rows = (data as unknown as Row[]) ?? [];

  const unposted = rows.filter((v) => v.status !== "posted");

  const waitingOnYou: DigestData["waitingOnYou"] = [
    ...rows
      .filter((v) => v.status === "in_review")
      .map((v) => ({ title: v.title, why: "a new cut needs your notes" })),
    ...rows
      .filter((v) => v.status === "final_review")
      .map((v) => ({ title: v.title, why: "hook variants are in — last look" })),
    ...rows
      .filter((v) => v.status === "ready_to_film")
      .map((v) => ({ title: v.title, why: "scripted, waiting to be shot" })),
  ];

  const scheduled = unposted
    .filter((v) => v.post_date && v.post_date >= today)
    .map((v) => v.post_date as string)
    .sort();
  const lastDate = scheduled.at(-1) ?? null;

  // Best-effort: a hiccup reading numbers must never stop the digest going out.
  const performance = await buildPerformance(db, now).catch(() => null);
  const research = await buildResearchBlock(db, now).catch(() => null);

  return {
    performance,
    research,
    weekOf: short(today),
    posted: rows
      .filter((v) => v.status === "posted" && v.posted_at && v.posted_at >= weekAgo)
      .map((v) => ({ title: v.title, date: v.posted_at })),
    postingNext: unposted
      .filter((v) => v.post_date && v.post_date >= today && v.post_date <= weekAhead)
      .sort((a, b) => (a.post_date ?? "").localeCompare(b.post_date ?? ""))
      .map((v) => ({ title: v.title, date: v.post_date as string })),
    waitingOnYou,
    withEditors: rows
      .filter((v) => (v.status === "in_progress" || v.status === "revisions") && v.assigned_editor)
      .map((v) => ({
        title: v.title,
        editor: v.assigned_editor?.full_name || v.assigned_editor?.email || "an editor",
        eta: v.eta_at,
      })),
    runwayDays: lastDate
      ? Math.round(
          (new Date(`${lastDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) /
            864e5
        )
      : null,
    ideas: unposted.filter((v) => v.status === "ideation").length,
    scripts: unposted.filter((v) => v.status === "scripting").length,
    toFilm: unposted.filter((v) => v.status === "ready_to_film").length,
  };
}

/* ------------------------------------------------------------------ email -- */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function section(title: string, body: string): string {
  return `<tr><td style="padding:0 0 22px">
    <p style="margin:0 0 8px;font:600 11px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#8a8598">${esc(title)}</p>
    ${body}
  </td></tr>`;
}

function list(items: string[]): string {
  if (!items.length) {
    return `<p style="margin:0;font:400 14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#8a8598">Nothing this week.</p>`;
  }
  return items
    .map(
      (i) =>
        `<p style="margin:0 0 6px;font:400 14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#17141f">${i}</p>`
    )
    .join("");
}

/** A saved link is only ever put in an href or a Slack link when it is a plain http(s) address. */
const safeHref = (u: string | null | undefined): string | null => (u && /^https?:\/\/[^\s<>"'|]+$/i.test(u) ? u : null);
const escTg = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

function postLine(p: PerfPost, extra = ""): string {
  const href = safeHref(p.link);
  const name = href
    ? `<a href="${esc(href)}" style="color:#5b3fd6;text-decoration:none">${esc(p.title)}</a>`
    : esc(p.title);
  const hook = p.hook ? `<br><span style="color:#8a8598">“${esc(p.hook.length > 90 ? p.hook.slice(0, 89) + "…" : p.hook)}”</span>` : "";
  return `${name} <strong style="color:#17141f">${fmtViews(p.views)} views</strong>${extra}${hook}`;
}

function researchHtml(r: ResearchBlock | null, appUrl: string): string {
  if (!r) return "";
  const btn = (href: string, label: string, bg: string) =>
    `<a href="${esc(href)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 16px;border-radius:9px;background:${bg};font:600 13px/1 ${FONT};color:#fff;text-decoration:none">${label}</a>`;
  const finds = r.finds.length
    ? list(
        r.finds.map(
          (f) =>
            `${safeHref(f.link) ? `<a href="${esc(safeHref(f.link)!)}" style="color:#5b3fd6;text-decoration:none">${esc(f.topic)}</a>` : esc(f.topic)} <strong style="color:#17141f">${fmtViews(f.views)} views</strong>${
              f.hook ? `<br><span style="color:#8a8598">“${esc(f.hook.length > 90 ? f.hook.slice(0, 89) + "…" : f.hook)}”</span>` : ""
            }`
        )
      )
    : `<p style="margin:0 0 6px;font:400 14px/1.5 ${FONT};color:#8a8598">Nothing new was added last week.</p>`;
  return (
    section("New viral finds this week", finds) +
    section(
      "This week's research (one click)",
      `<p style="margin:0 0 10px;font:400 14px/1.5 ${FONT};color:#17141f">Opens a chat with the research prompt already typed in. It reads your offer and ideal client, browses for what is working in your niche, and adds it to <a href="${esc(appUrl)}/library/top-posts" style="color:#5b3fd6;text-decoration:none">Top posts</a>.</p>` +
        btn(r.chatgptUrl, "Open in ChatGPT", "#10a37f") +
        btn(r.claudeUrl, "Open in Claude", "#c96442")
    )
  );
}

const pct = (now: number, before: number | null) =>
  before && before > 0 ? Math.round(((now - before) / before) * 100) : null;

function performanceHtml(perf: PerformanceDigest | null, appUrl: string): string {
  if (!perf) return "";
  if (!perf.hasData) {
    return section(
      "Performance",
      `<p style="margin:0;font:400 14px/1.5 ${FONT};color:#8a8598">No numbers yet. They appear once trial numbers are typed in or a post is linked to Instagram.</p>`
    );
  }
  const change = pct(perf.week.views, perf.week.prevViews);
  const trend =
    change === null
      ? ""
      : change >= 0
        ? ` <span style="color:#0f8a5f">▲ ${change}% on the week before</span>`
        : ` <span style="color:#c0304a">▼ ${Math.abs(change)}% on the week before</span>`;
  const summary = `<p style="margin:0 0 10px;font:400 14px/1.5 ${FONT};color:#17141f">
      <strong>Last 7 days:</strong> ${perf.week.posts} post${perf.week.posts === 1 ? "" : "s"}, ${fmtViews(perf.week.views)} views${trend}<br>
      <strong>Last 30 days:</strong> ${perf.month.posts} post${perf.month.posts === 1 ? "" : "s"}, ${fmtViews(perf.month.views)} views${
        perf.typicalViews ? `<br><span style="color:#8a8598">A typical post gets about ${fmtViews(perf.typicalViews)} views.</span>` : ""
      }</p>`;

  const outliers = perf.outliers.length
    ? section(
        "Standouts",
        list(
          perf.outliers.map((o) =>
            postLine(
              o,
              ` <span style="color:${o.direction === "high" ? "#0f8a5f" : "#c0304a"}">${o.direction === "high" ? "🔥" : "⚠️"} ${
                o.multiple >= 1 ? `${o.multiple.toFixed(1)}×` : `${Math.round(o.multiple * 100)}%`
              } your usual${o.thisWeek ? "" : " · earlier this month"}</span>`
            )
          )
        )
      )
    : "";

  return (
    section(`Performance`, summary + list(perf.topWeek.map((p) => postLine(p))).replace("Nothing this week.", "No numbers on this week's posts yet.")) +
    outliers +
    section("Best of the last 30 days", list(perf.topMonth.map((p) => postLine(p)))) +
    `<tr><td style="padding:0 0 18px"><a href="${esc(appUrl)}/library/top-posts" style="font:400 13px/1 ${FONT};color:#5b3fd6;text-decoration:none">See and add to the top posts list →</a></td></tr>`
  );
}

/**
 * The digest as HTML.
 *
 * Table-based and fully inline-styled because that is still what mail clients
 * render reliably; Outlook has no grid and Gmail strips <style> blocks. Light
 * palette only — a dark email on a light client reads as broken, and the
 * inverse is a bearable compromise.
 */
export function digestHtml(d: DigestData, appUrl: string, name: string): string {
  const runway =
    d.runwayDays === null
      ? `<span style="color:#c0304a">Nothing is scheduled.</span>`
      : d.runwayDays <= 3
        ? `<span style="color:#c0304a">${d.runwayDays} days of posts left — worth booking a shoot.</span>`
        : d.runwayDays <= 10
          ? `<span style="color:#a96a00">${d.runwayDays} days of posts scheduled.</span>`
          : `<span style="color:#0f8a5f">${d.runwayDays} days of posts scheduled.</span>`;

  return `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f4f2f8">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;border:1px solid #e6e3ee">
<tr><td style="padding:28px 28px 20px">
  <p style="margin:0 0 2px;font:600 19px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#17141f">Your week, ${esc(name)}</p>
  <p style="margin:0;font:400 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#8a8598">Week of ${esc(d.weekOf)} · ${runway}</p>
</td></tr>
<tr><td style="padding:0 28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">

${section(
  `Waiting on you (${d.waitingOnYou.length})`,
  list(d.waitingOnYou.slice(0, 8).map((w) => `${esc(w.title)} <span style="color:#8a8598">— ${esc(w.why)}</span>`))
)}

${section(
  `Went out this week (${d.posted.length})`,
  list(d.posted.map((p) => `${esc(p.title)} <span style="color:#8a8598">${esc(short(p.date))}</span>`))
)}

${section(
  `Posting next 7 days (${d.postingNext.length})`,
  list(d.postingNext.map((p) => `${esc(p.title)} <span style="color:#8a8598">${esc(short(p.date))}</span>`))
)}

${section(
  `With the editors (${d.withEditors.length})`,
  list(
    d.withEditors
      .slice(0, 8)
      .map(
        (w) =>
          `${esc(w.title)} <span style="color:#8a8598">— ${esc(w.editor)}${w.eta ? `, due ${esc(short(w.eta))}` : ""}</span>`
      )
  )
)}

${performanceHtml(d.performance, appUrl)}

${researchHtml(d.research, appUrl)}

${section(
  "In the pipeline",
  `<p style="margin:0;font:400 14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#17141f">
    ${d.ideas} idea${d.ideas === 1 ? "" : "s"} · ${d.scripts} being written · ${d.toFilm} to film
  </p>`
)}

<tr><td style="padding:4px 0 8px">
  <a href="${esc(appUrl)}" style="display:inline-block;padding:11px 20px;border-radius:9px;background:#5b3fd6;font:600 14px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#fff;text-decoration:none">Open the dashboard</a>
</td></tr>
</table>
</td></tr>
<tr><td style="padding:8px 28px 24px;border-top:1px solid #e6e3ee">
  <p style="margin:0;font:400 11px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#8a8598">
    Sent every Monday. Change how often you hear from us in the dashboard under Notifications.
  </p>
</td></tr>
</table></body></html>`;
}

function researchText(r: ResearchBlock | null): string[] {
  if (!r) return [];
  return [
    "NEW VIRAL FINDS THIS WEEK",
    ...(r.finds.length ? r.finds.map((f) => `- ${f.topic} — ${fmtViews(f.views)} views${f.hook ? ` · “${f.hook.slice(0, 80)}”` : ""}${f.link ? ` ${f.link}` : ""}`) : ["- nothing new"]),
    "",
    "THIS WEEK'S RESEARCH (one click, prompt pre-typed):",
    `ChatGPT: ${r.chatgptUrl}`,
    `Claude: ${r.claudeUrl}`,
    "",
  ];
}

function performanceText(perf: PerformanceDigest | null): string[] {
  if (!perf) return [];
  if (!perf.hasData) return ["PERFORMANCE", "- no numbers yet", ""];
  const line = (p: PerfPost, extra = "") => `- ${p.title} — ${fmtViews(p.views)} views${extra}${p.hook ? ` · “${p.hook.slice(0, 80)}”` : ""}${p.link ? ` ${p.link}` : ""}`;
  return [
    "PERFORMANCE",
    `Last 7 days: ${perf.week.posts} posts, ${fmtViews(perf.week.views)} views${(() => {
      const c = pct(perf.week.views, perf.week.prevViews);
      return c === null ? "" : ` (${c >= 0 ? "+" : ""}${c}% on the week before)`;
    })()}`,
    `Last 30 days: ${perf.month.posts} posts, ${fmtViews(perf.month.views)} views${perf.typicalViews ? ` · typical post ${fmtViews(perf.typicalViews)}` : ""}`,
    ...(perf.outliers.length
      ? ["Standouts:", ...perf.outliers.map((o) => line(o, ` — ${o.multiple >= 1 ? o.multiple.toFixed(1) + "x" : Math.round(o.multiple * 100) + "%"} your usual`))]
      : []),
    ...(perf.topWeek.length ? ["Top this week:", ...perf.topWeek.map((p) => line(p))] : []),
    ...(perf.topMonth.length ? ["Best of the last 30 days:", ...perf.topMonth.map((p) => line(p))] : []),
    "",
  ];
}

/** Plain-text fallback. Some clients only ever show this. */
export function digestText(d: DigestData, appUrl: string, name: string): string {
  const lines = [
    `Your week, ${name} — week of ${d.weekOf}`,
    d.runwayDays === null
      ? "Nothing is scheduled."
      : `${d.runwayDays} days of posts scheduled.`,
    "",
    `WAITING ON YOU (${d.waitingOnYou.length})`,
    ...(d.waitingOnYou.length
      ? d.waitingOnYou.slice(0, 8).map((w) => `- ${w.title} — ${w.why}`)
      : ["- nothing"]),
    "",
    `WENT OUT THIS WEEK (${d.posted.length})`,
    ...(d.posted.length ? d.posted.map((p) => `- ${p.title} ${short(p.date)}`) : ["- nothing"]),
    "",
    `POSTING NEXT 7 DAYS (${d.postingNext.length})`,
    ...(d.postingNext.length
      ? d.postingNext.map((p) => `- ${p.title} ${short(p.date)}`)
      : ["- nothing"]),
    "",
    `WITH THE EDITORS (${d.withEditors.length})`,
    ...(d.withEditors.length
      ? d.withEditors
          .slice(0, 8)
          .map((w) => `- ${w.title} — ${w.editor}${w.eta ? `, due ${short(w.eta)}` : ""}`)
      : ["- nothing"]),
    "",
    ...performanceText(d.performance),
    ...researchText(d.research),
    `PIPELINE: ${d.ideas} ideas, ${d.scripts} being written, ${d.toFilm} to film`,
    "",
    appUrl,
  ];
  return lines.join("\n");
}

function telegramPerformance(perf: PerformanceDigest | null): string[] {
  if (!perf || !perf.hasData) return [];
  const escT = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const c = pct(perf.week.views, perf.week.prevViews);
  return [
    "",
    `<b>📈 Performance</b>`,
    `7 days: ${perf.week.posts} posts · ${fmtViews(perf.week.views)} views${c === null ? "" : ` (${c >= 0 ? "▲" : "▼"}${Math.abs(c)}%)`}`,
    `30 days: ${perf.month.posts} posts · ${fmtViews(perf.month.views)} views`,
    ...perf.outliers.slice(0, 3).map(
      (o) => `${o.direction === "high" ? "🔥" : "⚠️"} ${escT(o.title)} — ${fmtViews(o.views)} (${o.multiple >= 1 ? o.multiple.toFixed(1) + "×" : Math.round(o.multiple * 100) + "%"} usual)`
    ),
  ];
}

/** The Slack version: the same week, in Slack's own markup. */
export function digestSlack(d: DigestData): string {
  const clean = (s: string) => s.replace(/[<>|&]/g, "");
  const perf = d.performance;
  const lines = [
    `*📊 Your week* — week of ${d.weekOf}`,
    d.runwayDays === null ? "⚠️ Nothing is scheduled." : `${d.runwayDays} days of posts scheduled.`,
    `*Waiting on you:* ${d.waitingOnYou.length} · *Went out:* ${d.posted.length} · *Posting next 7 days:* ${d.postingNext.length}`,
    `*Pipeline:* ${d.ideas} ideas · ${d.scripts} scripting · ${d.toFilm} to film`,
  ];
  if (perf?.hasData) {
    const c = pct(perf.week.views, perf.week.prevViews);
    lines.push(
      "",
      "*📈 Performance*",
      `Last 7 days: ${perf.week.posts} posts · ${fmtViews(perf.week.views)} views${c === null ? "" : ` (${c >= 0 ? "▲" : "▼"} ${Math.abs(c)}%)`}`,
      `Last 30 days: ${perf.month.posts} posts · ${fmtViews(perf.month.views)} views`,
      ...perf.outliers.slice(0, 4).map((o) => {
        const l = safeHref(o.link);
        const t = l ? `<${l}|${clean(o.title)}>` : clean(o.title);
        return `${o.direction === "high" ? "🔥" : "⚠️"} ${t} — ${fmtViews(o.views)} views (${o.multiple >= 1 ? o.multiple.toFixed(1) + "×" : Math.round(o.multiple * 100) + "%"} your usual)`;
      })
    );
  }
  if (d.research) {
    lines.push("", "*🔎 This week's research*", `<${d.research.chatgptUrl}|Open in ChatGPT> · <${d.research.claudeUrl}|Open in Claude>`);
    if (d.research.finds.length) lines.push(`Last week's finds: ${d.research.finds.length} added to Top posts.`);
  }
  return lines.join("\n");
}

/** For the Telegram version — same content, Telegram's own HTML subset. */
export function digestTelegram(d: DigestData): string {
  const lines = [
    `<b>📊 Your week</b> — week of ${d.weekOf}`,
    d.runwayDays === null
      ? "⚠️ Nothing is scheduled."
      : `${d.runwayDays <= 3 ? "⚠️ " : ""}${d.runwayDays} days of posts scheduled.`,
    "",
    `<b>Waiting on you (${d.waitingOnYou.length})</b>`,
    ...(d.waitingOnYou.length
      ? d.waitingOnYou.slice(0, 6).map((w) => `→ ${escTg(w.title)} — ${escTg(w.why)}`)
      : ["→ nothing"]),
    "",
    `<b>Went out</b>: ${d.posted.length} · <b>Posting next 7 days</b>: ${d.postingNext.length}`,
    `<b>Pipeline</b>: ${d.ideas} ideas · ${d.scripts} scripting · ${d.toFilm} to film`,
    ...telegramPerformance(d.performance),
  ];
  return lines.join("\n");
}

export { short as shortDigestDate, STATUS_LABELS };
