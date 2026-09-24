/**
 * Turn whatever gets pasted into rows for the Top posts list.
 *
 * People paste from a spreadsheet, from a chat with ChatGPT or Claude, or type
 * lines by hand, so this accepts all of them: a JSON array, a table with a header
 * row (tab, comma or pipe separated), or loose lines where the link and the views
 * are picked out wherever they sit. Pure text in, rows out — nothing is saved here.
 */

export interface TopPostInput {
  topic: string;
  hook?: string | null;
  views?: number | null;
  link?: string | null;
  platform?: string | null;
  creator?: string | null;
  format?: string | null;
  posted_on?: string | null;
  notes?: string | null;
  source?: "own" | "inspiration";
}

/** "1.2M", "350k", "12,400", "1 200 000 views" -> a number. */
export function parseViews(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw) : null;
  if (typeof raw !== "string") return null;
  const m = raw.trim().toLowerCase().replace(/views?/g, "").replace(/[, ]/g, "").match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!m) return null;
  const mult = m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : m[2] === "b" ? 1e9 : 1;
  return Math.round(parseFloat(m[1]) * mult);
}

const URL_RE = /https?:\/\/[^\s<>"'|,;]+/i;

export function platformOf(link: string | null | undefined): string | null {
  if (!link) return null;
  try {
    const h = new URL(link).hostname.replace(/^www\./, "");
    if (h.includes("instagram")) return "instagram";
    if (h.includes("tiktok")) return "tiktok";
    if (h.includes("youtube") || h.includes("youtu.be")) return "youtube";
    if (h.includes("linkedin")) return "linkedin";
    if (h === "x.com" || h.includes("twitter")) return "x";
    return "other";
  } catch {
    return null;
  }
}

const HEADER_KEYS: Record<string, keyof TopPostInput> = {
  views: "views", view: "views", plays: "views",
  topic: "topic", title: "topic", subject: "topic", about: "topic",
  hook: "hook", opener: "hook", "opening line": "hook",
  link: "link", url: "link",
  platform: "platform", network: "platform",
  creator: "creator", account: "creator", handle: "creator", channel: "creator", author: "creator",
  format: "format", type: "format",
  date: "posted_on", posted: "posted_on", "posted on": "posted_on",
  notes: "notes", note: "notes", why: "notes", comment: "notes",
  source: "source",
};

function splitLine(line: string): string[] {
  const sep = line.includes("\t") ? "\t" : line.includes("|") ? "|" : ",";
  return line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
}

function clean(row: TopPostInput): TopPostInput | null {
  const link = row.link?.trim() || null;
  const topic = (row.topic ?? "").trim() || (row.hook ?? "").trim();
  if (!topic && !link) return null;
  return {
    topic: topic || link!,
    hook: row.hook?.trim() || null,
    views: parseViews(row.views ?? null),
    link,
    platform: (row.platform?.trim().toLowerCase() || platformOf(link)) ?? null,
    creator: row.creator?.trim() || null,
    format: row.format?.trim() || null,
    posted_on: /^\d{4}-\d{2}-\d{2}/.test(row.posted_on ?? "") ? (row.posted_on as string).slice(0, 10) : null,
    notes: row.notes?.trim() || null,
    source: row.source === "own" ? "own" : "inspiration",
  };
}

export function parsePastedPosts(text: string): TopPostInput[] {
  const t = text.trim();
  if (!t) return [];

  // JSON, e.g. straight from an AI: [{"topic": "...", "views": 120000, ...}]
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      const parsed = JSON.parse(t) as unknown;
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list
        .map((o) => {
          const r = o as Record<string, unknown>;
          return clean({
            topic: String(r.topic ?? r.title ?? r.subject ?? ""),
            hook: (r.hook ?? r.opener ?? null) as string | null,
            views: parseViews(r.views ?? r.plays ?? null),
            link: (r.link ?? r.url ?? null) as string | null,
            platform: (r.platform ?? null) as string | null,
            creator: (r.creator ?? r.account ?? r.handle ?? null) as string | null,
            format: (r.format ?? null) as string | null,
            posted_on: (r.posted_on ?? r.date ?? null) as string | null,
            notes: (r.notes ?? r.why ?? null) as string | null,
            source: r.source === "own" ? "own" : "inspiration",
          });
        })
        .filter((r): r is TopPostInput => r !== null);
    } catch {
      /* not JSON after all: fall through to lines */
    }
  }

  const lines = t
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter((l) => l && !/^[-|:\s]+$/.test(l));

  // A header row names the columns.
  const first = splitLine(lines[0] ?? "");
  const mapped = first.map((c) => HEADER_KEYS[c.toLowerCase()]);
  const hasHeader = first.length >= 2 && mapped.filter(Boolean).length >= 2 && !URL_RE.test(lines[0]);
  if (hasHeader) {
    return lines
      .slice(1)
      .map((l) => {
        const cells = splitLine(l);
        const row: Record<string, unknown> = {};
        mapped.forEach((k, i) => {
          if (k && cells[i] !== undefined && cells[i] !== "") row[k] = cells[i];
        });
        return clean(row as unknown as TopPostInput);
      })
      .filter((r): r is TopPostInput => r !== null);
  }

  // Loose lines: pick the link and the views wherever they are; the first two
  // remaining pieces are the topic and the hook.
  return lines
    .map((line) => {
      const link = URL_RE.exec(line)?.[0] ?? null;
      const rest = link ? line.replace(link, " ") : line;
      const parts = (rest.includes("|") || rest.includes("\t") ? splitLine(rest) : rest.split(/\s+[-–—]\s+|\s{2,}|;/)).map((p) => p.trim()).filter(Boolean);
      let views: number | null = null;
      const others: string[] = [];
      for (const p of parts) {
        const v: number | null = views === null ? parseViews(p) : null;
        if (views === null && v !== null) views = v;
        else if (views === null && /^\s*[\d.,]+\s*[kKmM]?\s+views?\b/.test(p)) {
          views = parseViews(p.match(/^\s*([\d.,]+\s*[kKmM]?)/)![1]);
          const remainder = p.replace(/^\s*[\d.,]+\s*[kKmM]?\s+views?\b[:\s-]*/i, "").trim();
          if (remainder) others.push(remainder);
        } else others.push(p);
      }
      return clean({ topic: others[0] ?? "", hook: others[1] ?? null, views, link });
    })
    .filter((r): r is TopPostInput => r !== null);
}
