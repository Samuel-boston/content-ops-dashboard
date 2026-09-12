import Link from "next/link";
import { Chip, PriorityPill } from "@/components/badges";
import { EtaBadge } from "@/components/pipeline/Eta";
import {
  IconCheck,
  IconChevronRight,
  IconClock,
  IconFile,
  IconLayers,
  IconPlay,
  IconRevisions,
} from "@/components/ui/icons";
import { STATUS_COLOR, STATUS_LABELS } from "@/lib/types";
import { agingTone, type TaskGroups, type TaskItem } from "@/lib/tasks";

/**
 * "What do I need to do right now" — the editor's task board.
 *
 * Grouped by task type rather than by month or by raw stage label, because
 * that's the question an editor actually has: which of my videos need a
 * first cut, which need revisions, which are owed hook variants — not "go
 * into September and read the badges."
 */
export function TaskBoard({ groups }: { groups: TaskGroups }) {
  const empty =
    groups.revisions.length === 0 &&
    groups.firstCut.length === 0 &&
    groups.variants.length === 0 &&
    groups.inProgress.length === 0 &&
    groups.other.length === 0;

  if (empty) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-ok/30 bg-ok/5 px-4 py-3">
        <span className="text-ok">
          <IconCheck size={16} />
        </span>
        <p className="text-sm text-ink-2">
          Nothing needs you right now. Take something from the Editing Bay when you&rsquo;re ready.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <TaskSection
        title="Needs revisions"
        hint="The client asked for changes"
        icon={<IconRevisions size={13} />}
        tone="var(--color-stage-revisions)"
        items={groups.revisions}
        meta={(it) => <EtaMeta item={it} emptyLabel="No ETA set" />}
      />
      <TaskSection
        title="Needs a first cut"
        hint="Claimed — nothing uploaded yet"
        icon={<IconFile size={13} />}
        tone="var(--color-stage-progress)"
        items={groups.firstCut}
        meta={(it) => <EtaMeta item={it} emptyLabel="No ETA set" />}
      />
      <TaskSection
        title="Needs hook variants"
        hint="Approved — no formal ETA, but ageing shows here"
        icon={<IconLayers size={13} />}
        tone="var(--color-stage-variants)"
        items={groups.variants}
        meta={(it) => <AgingMeta item={it} />}
      />
      <TaskSection
        title="Still editing"
        hint="Draft uploaded — finish up and submit when ready"
        icon={<IconPlay size={13} />}
        tone="var(--color-accent)"
        items={groups.inProgress}
        meta={(it) => <EtaMeta item={it} emptyLabel="No ETA set" />}
      />
      <TaskSection
        title="Needs your attention"
        hint="With you right now"
        icon={<IconClock size={13} />}
        tone="var(--color-ink-2)"
        items={groups.other}
        meta={() => null}
      />
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
function AgingMeta({ item }: { item: TaskItem }) {
  const days = item.daysInStage;
  const tone = agingTone(days);
  const style = AGING_STYLE[tone];
  const label =
    days <= 0 ? "Approved today" : `${days} day${days === 1 ? "" : "s"} since approval`;

  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] ${style.wrap}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {label}
    </span>
  );
}

function TaskSection({
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
  if (items.length === 0) return null;

  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2 px-0.5">
        <span style={{ color: tone }}>{icon}</span>
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="rounded-md bg-raised px-1.5 py-0.5 text-[11px] tabular-nums text-ink-3">
          {items.length}
        </span>
        <span className="ml-auto hidden text-[11px] text-ink-3 sm:inline">{hint}</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-card">
        {items.map((it, i) => (
          <Link
            key={it.video.id}
            href={`/videos/${it.video.id}`}
            className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition hover:bg-hover/40 ${
              i !== items.length - 1 ? "border-b border-line" : ""
            }`}
          >
            <span className="min-w-[140px] flex-1 truncate text-sm font-medium">
              {it.video.title}
            </span>
            {it.video.priority !== "standard" ? <PriorityPill priority={it.video.priority} /> : null}
            <span className="hidden gap-1 sm:flex">
              {(it.video.formats ?? []).slice(0, 1).map((t) => (
                <Chip key={t}>{t}</Chip>
              ))}
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: STATUS_COLOR[it.video.status] }}
              />
              {STATUS_LABELS[it.video.status]}
            </span>
            {meta(it)}
            <IconChevronRight size={12} className="ml-auto shrink-0 text-ink-3 sm:ml-0" />
          </Link>
        ))}
      </div>
    </section>
  );
}
