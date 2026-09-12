/**
 * A deliberately tiny Markdown renderer for the SOP/playbook.
 *
 * Input is escaped FIRST, then a fixed set of inline/block patterns are
 * re-introduced — so no raw HTML from the document can ever reach the DOM.
 * Supports: # headings, **bold**, *italic*, `code`, - / 1. lists, > quotes,
 * [links](url), and --- rules. That covers a house-style doc without pulling
 * in a parser dependency.
 */
export function Markdown({ source }: { source: string }) {
  return <div className="cod-md space-y-2 text-sm text-ink-2">{render(source)}</div>;
}

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(raw: string) {
  let s = esc(raw);
  s = s.replace(/`([^`]+)`/g, '<code class="rounded bg-raised px-1 py-0.5 text-[0.85em]">$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong class="text-ink">$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // Only http(s) links — no javascript: or data: URLs.
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer" class="text-accent-hi underline">$1</a>'
  );
  return s;
}

function render(source: string) {
  const lines = source.split("\n");
  const out: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flush = () => {
    if (!list) return;
    const items = list.items.map((t, i) => (
      <li key={i} dangerouslySetInnerHTML={{ __html: inline(t) }} />
    ));
    out.push(
      list.ordered ? (
        <ol key={out.length} className="list-decimal space-y-1 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={out.length} className="list-disc space-y-1 pl-5">
          {items}
        </ul>
      )
    );
    list = null;
  };

  for (const line of lines) {
    const t = line.trimEnd();

    const ul = t.match(/^\s*[-*]\s+(.*)$/);
    const ol = t.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const ordered = Boolean(ol);
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((ul?.[1] ?? ol?.[1]) as string);
      continue;
    }
    flush();

    if (!t.trim()) continue;

    if (/^---+$/.test(t.trim())) {
      out.push(<hr key={out.length} className="border-line" />);
      continue;
    }

    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const cls =
        level === 1
          ? "text-base font-semibold text-ink mt-3"
          : level === 2
            ? "text-sm font-semibold text-ink mt-3"
            : "text-xs font-semibold uppercase tracking-wide text-ink-2 mt-2";
      out.push(
        <p key={out.length} className={cls} dangerouslySetInnerHTML={{ __html: inline(h[2]) }} />
      );
      continue;
    }

    const q = t.match(/^>\s?(.*)$/);
    if (q) {
      out.push(
        <blockquote
          key={out.length}
          className="border-l-2 border-line-strong pl-3 text-ink-2"
          dangerouslySetInnerHTML={{ __html: inline(q[1]) }}
        />
      );
      continue;
    }

    out.push(<p key={out.length} dangerouslySetInnerHTML={{ __html: inline(t) }} />);
  }
  flush();

  return out;
}
