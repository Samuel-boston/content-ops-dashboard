"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AvatarStack } from "@/components/ui/Avatar";
import { useToast } from "@/components/ui/Toast";
import { IconChevronRight, IconClock, IconComment, IconFile, IconLayers } from "@/components/ui/icons";
import { createFootageUploadUrlAction, registerAssetAction } from "@/app/asset-actions";
import { dayMonth, timecode } from "@/lib/format";
import { isStalled, PRIORITY_LABELS, type BoardCard } from "@/lib/types";

const PRIORITY_TONE: Record<string, string> = {
  urgent: "text-danger",
  high: "text-warn",
  standard: "text-ink-2",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="mb-0.5 block text-[9px] font-semibold uppercase tracking-wider text-ink-3">
        {label}
      </span>
      <span className="block truncate text-xs text-ink-2">{children}</span>
    </div>
  );
}

/** The presentational card. Split out so the drag overlay can reuse it. */
export function TaskCardBody({
  card,
  dragging,
  selected,
  onToggleSelect,
}: {
  card: BoardCard;
  dragging?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [footageState, setFootageState] = useState<"idle" | "uploading" | "done">("idle");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const toast = useToast();
  const overdue = card.post_date && new Date(card.post_date) < new Date() && card.status !== "posted";
  const stalled = isStalled(card);

  async function uploadFootage(file: File) {
    setFootageState("uploading");
    const res = await createFootageUploadUrlAction(card.id, file.name);
    if (!res?.ok) {
      toast.error(res?.error ?? "Could not start upload.");
      setFootageState("idle");
      return;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", res.signedUrl);
        xhr.setRequestHeader("x-upsert", "true");
        xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.send(file);
      });
      await registerAssetAction({ videoId: card.id, label: file.name, storagePath: res.path, sizeBytes: file.size });
      setFootageState("done");
      toast.success("Footage added.");
      router.refresh();
      setTimeout(() => setFootageState("idle"), 1800);
    } catch (e) {
      toast.error((e as Error).message);
      setFootageState("idle");
    }
  }

  return (
    <div
      className={`rounded-lg border bg-card p-2 transition ${
        dragging
          ? "border-accent shadow-2xl"
          : selected
            ? "border-accent bg-raised"
            : "border-line hover:border-line-strong hover:bg-raised"
      }`}
    >
      {onToggleSelect ? (
        <label
          onClick={(e) => e.stopPropagation()}
          className="mb-1.5 flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-3"
        >
          <input
            type="checkbox"
            checked={!!selected}
            onChange={onToggleSelect}
            className="h-3.5 w-3.5 accent-[var(--color-accent)]"
          />
          {selected ? "Selected" : "Select"}
        </label>
      ) : null}

      <div className="flex items-start gap-2">
        {/* Thumbnail — also a raw-footage dropzone, so a file never has to
            wait for someone to open the video's own page first. Small and
            square so a whole column of cards fits on one screen. */}
        <div
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              setDragOver(true);
            }
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) uploadFootage(file);
          }}
          className={`relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-app ${dragOver ? "ring-2 ring-accent" : ""}`}
        >
          {card.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.thumbnail_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-ink-3">
              <IconLayers size={14} />
            </div>
          )}
          {stalled ? (
            <span className="absolute inset-x-0 top-0 h-1 bg-warn" />
          ) : null}
          <button
            type="button"
            title="Add raw footage"
            disabled={footageState === "uploading"}
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
            className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition hover:bg-black/50 hover:opacity-100"
          >
            {footageState === "uploading" ? (
              <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-white border-t-transparent" />
            ) : footageState === "done" ? (
              "✓"
            ) : (
              <IconFile size={12} />
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            hidden
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadFootage(file);
              e.target.value = "";
            }}
          />
          {dragOver ? (
            <div className="absolute inset-0 flex items-center justify-center bg-accent/40 text-[8px] font-medium text-white">
              Drop
            </div>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <Link
            href={`/videos/${card.id}`}
            onClick={(e) => e.stopPropagation()}
            className="block truncate text-[13px] font-medium leading-tight hover:text-accent-hi"
          >
            {card.title}
          </Link>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-ink-3">
            {card.duration_seconds ? (
              <span className="font-mono">{timecode(card.duration_seconds)} · </span>
            ) : null}
            {card.content_pillars[0] ?? dayMonth(card.created_at)}
            {card.open_comments > 0 ? (
              <span className="flex items-center gap-0.5">
                <IconComment size={9} />
                {card.open_comments}
              </span>
            ) : null}
          </p>
        </div>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-line pt-1.5">
        <span
          className={`flex items-center gap-1 truncate text-[11px] ${overdue ? "text-danger" : "text-ink-3"}`}
        >
          {overdue ? <IconClock size={10} /> : null}
          {dayMonth(card.post_date)}
        </span>
        <span className={`shrink-0 text-[11px] ${PRIORITY_TONE[card.priority]}`}>
          {PRIORITY_LABELS[card.priority]}
        </span>
        <AvatarStack people={card.assigned_editor ? [card.assigned_editor] : []} size="sm" />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          title={expanded ? "Fewer fields" : "More fields"}
          className="shrink-0 rounded p-0.5 text-ink-3 hover:bg-hover hover:text-ink-2"
        >
          <IconChevronRight
            size={11}
            className={`transition-transform ${expanded ? "rotate-90" : ""}`}
          />
        </button>
      </div>

      {expanded ? (
        <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1.5 border-t border-line pt-1.5">
          <Field label="Platform">{card.platforms[0] ?? "—"}</Field>
          <Field label="Format">{card.formats[0] ?? "—"}</Field>
          <Field label="Pillars">{card.content_pillars.length || "—"}</Field>
          <Field label="Script">{card.needs_script ? "Needed" : "Ready"}</Field>
          <Field label="Version">{card.version ? `v${card.version}` : "—"}</Field>
          <Field label="Created">{dayMonth(card.created_at)}</Field>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Draggable wrapper. The whole card opens the video — a bare click anywhere
 * that isn't already a control navigates. The drag sensor needs 6px of travel
 * before it engages, so a click and a drag never fight over the same gesture.
 */
export function TaskCard({
  card,
  selected,
  onToggleSelect,
}: {
  card: BoardCard;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const router = useRouter();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { status: card.status },
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      role="link"
      tabIndex={0}
      onClick={(e) => {
        // Let the real controls on the card do their own thing.
        if ((e.target as HTMLElement).closest("a,button,input,label")) return;
        router.push(`/videos/${card.id}`);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) router.push(`/videos/${card.id}`);
      }}
      className={`cursor-pointer touch-none ${isDragging ? "opacity-35" : ""}`}
    >
      <TaskCardBody card={card} selected={selected} onToggleSelect={onToggleSelect} />
    </div>
  );
}
