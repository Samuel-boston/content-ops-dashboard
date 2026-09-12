import { IconFile, IconFolder } from "@/components/ui/icons";
import type { GuestAssetItem } from "@/app/guest-actions";

/**
 * The reverse of GuestUpload — instead of asking a phone to send something
 * in, this hands it everything needed to start cutting: the brief, the raw
 * footage, and whatever reference clips/images/links were collected. Built
 * for a trial or freelance editor who doesn't have a dashboard login yet —
 * scan the QR code, get the package, no account needed.
 */
export function GuestAssets({
  videoTitle,
  brief,
  footage,
  references,
}: {
  videoTitle: string;
  brief: string | null;
  footage: GuestAssetItem[];
  references: GuestAssetItem[];
}) {
  const nothing = footage.length === 0 && references.length === 0 && !brief;

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-2">
        Everything for <span className="text-ink">{videoTitle}</span>.
      </p>

      {brief ? (
        <div className="rounded-xl border border-line bg-card p-4">
          <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Brief</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{brief}</p>
        </div>
      ) : null}

      {footage.length ? (
        <AssetGroup title="Raw footage" items={footage} />
      ) : (
        <p className="text-xs text-ink-3">No raw footage attached yet.</p>
      )}

      {references.length ? <AssetGroup title="Reference / inspiration" items={references} /> : null}

      {nothing ? (
        <p className="rounded-xl border border-line bg-card px-4 py-8 text-center text-sm text-ink-3">
          Nothing&rsquo;s been attached to this video yet.
        </p>
      ) : null}
    </div>
  );
}

function AssetGroup({ title, items }: { title: string; items: GuestAssetItem[] }) {
  return (
    <div className="space-y-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{title}</h2>
      <div className="space-y-1.5">
        {items.map((it) =>
          it.url ? (
            <a
              key={it.id}
              href={it.url}
              target="_blank"
              rel="noreferrer"
              download={it.external ? undefined : ""}
              className="flex items-center gap-2.5 rounded-xl border border-line bg-card px-3 py-2.5 text-sm transition hover:border-accent"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-panel text-ink-3">
                {it.external ? <IconFolder size={14} /> : <IconFile size={14} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ink">{it.label}</span>
                {it.note ? <span className="block truncate text-xs text-ink-3">{it.note}</span> : null}
              </span>
              <span className="shrink-0 text-[11px] text-accent-hi">
                {it.external ? "Open" : "Download"}
              </span>
            </a>
          ) : (
            <div
              key={it.id}
              className="flex items-center gap-2.5 rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink-3"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-panel">
                <IconFile size={14} />
              </span>
              <span className="min-w-0 flex-1 truncate">{it.label} — unavailable</span>
            </div>
          )
        )}
      </div>
    </div>
  );
}
