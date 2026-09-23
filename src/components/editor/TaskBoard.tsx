import Link from "next/link";
import { Chip, PriorityPill } from "@/components/badges";
import { EtaBadge } from "@/components/pipeline/Eta";
import {
  IconCheck,
  IconClock,
  IconFile,
  IconLayers,
  IconPlay,
  IconRevisions,
} from "@/components/ui/icons";
import { STATUS_COLOR, STATUS_LABELS } from "@/lib/types";
import { agingTone, type TaskGroups, type TaskItem } from "@/lib/tasks";

/**
 * The editor's board — "what do I need to do right now", as columns.
 *
 * Columns are task types rather than raw stage labels, because that's the
 * question an editor actually has: which of my videos need a first cut, which
 * need revisions, which are owed hook variants. A last column shows what's
 * already with the client, so nothing on the plate is invisible.
 */
export function TaskBoard({ groups }: { groups: TaskGroups }) {
  const columns: {
    key: string;
    title: string;
    hint: string;
    icon: React.ReactNode;
    tone: string;
    items: TaskItem[];
    meta: (it: TaskItem) => React.ReactNode;
  }[] = [
    {
      key: "revisions",
      title: "Needs revisions",
      hint: "The client asked for changes",
      icon: <IconRevisions size={13} />,
      tone: "var(--color-stage-revisions)",
      items: groups.revisions,
      meta: (it) => <EtaMeta item={it} emptyLabel="No ETA set" />,
    },
    {
      key: "firstCut",
      title: "Needs a first cut",
      hint: "Claimed — nothing uploaded yet",
      icon: <IconFile size={13} />,
      tone: "var(--color-stage-progress)",
      items: groups.firstCut,
      meta: (it) => <EtaMeta item={it} emptyLabel="No ETA set" />,
    },
    {
      key: "inProgress",
      title: "Still editing",
      hint: "Draft up — finish and submit",
      icon: <IconPlay size={13} />,
      tone: "var(--color-accent)",
      items: groups.inProgress,
      meta: (it) => <EtaMeta item={it} emptyLabel="No ETA set" />,
    },
    {
      key: "variants",
      title: "Needs hook variants",
      hint: "Approved — variants still to cut",
      icon: <IconLayers size={13} />,
      tone: "var(--color-stage-variants)",
      items: groups.variants,
      meta: (it) => <AgingMeta item={it} />,
    },
    ...(groups.other.length > 0
      ? [
          {
            key: "other",
            title: "Needs your attention",
            hint: "With you right now",
            icon: <IconClock size={13} />,
            tone: "var(--color-ink-2)",
            items: groups.other,
            meta: () => null,
          },
        ]
      : []),
    {
      key: "waiting",
      title: "With the client",
      hint: "Submitted — waiting on their review",
      icon: <IconCheck size={13} />,
      tone: "var(--color-stage-review)",
      items: groups.waiting,
      meta: (it) => <AgingMeta item={it} label="waiting" />,
    },
  ];

  const nothingToDo = columns.every((c) => c.key === "waiting" || c.items.length === 0);

  return (
    <div className="space-y-3">
      {nothingToDo ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-ok/30 bg-ok/5 px-4 py-3">
          <span className="text-ok">
            <IconCheck size={16} />
          </span>
          <p className="text-sm text-ink-2">
            Nothing needs you right now. Take something from the Editing Bay when you&rsquo;re ready.
          </p>
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {columns.map(({ key, ...c }) => (
          <TaskColumn key={key} {...c} />
        ))}
      </div>
    </div>
  );
}

function EtaMeta({ item, emptyLabel }: { item: TaskItem; emptyLabel: string }) {
  if (!item.video.eta_at) {
    return <span className="text-[11px] text-ink-3">{emptyLabel}</span>;
  }
  return <EtaBadge etaAt={item.video.eta_at} stage={item.video.eta_stage} overdue={item.overdue} />;
}

const AGING_STYLE: Record<
  ReturnType<typeof agingTone>,
  { wrap: string; dot: string }
> = {
  subtle: { wrap: "text-ink-3", dot: "bg-ink-3" },
  warn: { wrap: "rounded-md bg-warn/10 px-2 py-0.5 font-medium text-warn", dot: "bg-warn" },
  danger: {
    wrap: "rounded-md bg-danger/10 px-2 py-0.5 font-semibold text-danger",
    dot: "animate-pulse bg-danger",
  },
};

/**
 * The escalating "how long has this been sitting" signal for hook variants.
 * No priority field is invented here — the tone comes purely from time in
 * stage, ramping from unremarkable to unmissable as it ages.
 */
function AgingMeta({ item, label: kind = "approval" }: { item: TaskItem; label?: "approval" | "waiting" }) {
  const days = item.daysInStage;
  const tone = agingTone(days);
  const style = AGING_STYLE[kind === "waiting" ? "subtle" : tone];
  const label =
    kind === "waiting"
      ? days <= 0
        ? "Submitted today"
        : `${days} day${days === 1 ? "" : "s"} waiting`
      : days <= 0
        ? "Approved today"
        : `${days} day${days === 1 ? "" : "s"} since approval`;

  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] ${style.wrap}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {label}
    </span>
  );
}

function TaskColumn({
  title,
  hint,
  icon,
  tone,
  items,
  meta,
}: {
  title: string;
  hint: string;
  icon: React.ReactNode;
  tone: string;
  items: TaskItem[];
  meta: (item: TaskItem) => React.ReactNode;
}) {
  return (
    <section className="flex min-h-[8rem] flex-col rounded-xl border border-line bg-panel p-2">
      <div className="mb-2 px-1.5 pt-1">
        <div className="flex items-center gap-2">
          <span style={{ color: tone }}>{icon}</span>
          <h3 className="text-sm font-semibold">{title}</h3>
          <span className="ml-auto rounded-md bg-raised px-1.5 py-0.5 text-[11px] tabular-nums text-ink-3">
            {items.length}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-ink-3">{hint}</p>
      </div>
      <div className="flex-1 space-y-1.5">
        {items.length === 0 ? (
          <p className="px-2 py-4 text-center text-[11px] text-ink-3">Nothing here</p>
        ) : (
          items.map((it) => (
            <Link
              key={it.video.id}
              href={`/videos/${it.video.id}`}
              className="block space-y-1.5 rounded-lg border border-line bg-card px-3 py-2.5 transition hover:border-line-strong hover:bg-raised"
            >
              <span className="block truncate text-sm font-medium">{it.video.title}</span>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {it.video.priority !== "standard" ? (
                  <PriorityPill priority={it.video.priority} />
                ) : null}
                {(it.video.formats ?? []).slice(0, 1).map((t) => (
                  <Chip key={t}>{t}</Chip>
                ))}
                <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: STATUS_COLOR[it.video.status] }}
                  />
                  {STATUS_LABELS[it.video.status]}
                </span>
              </span>
              <span className="block">{meta(it)}</span>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}
