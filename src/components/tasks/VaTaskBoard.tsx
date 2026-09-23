"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import { IconCheck, IconClock, IconPlus } from "@/components/ui/icons";
import {
  createVaTaskAction,
  deleteVaTaskAction,
  setVaTaskDoneAction,
  updateVaTaskAction,
  type VaTask,
} from "@/app/task-actions";
import { PRIORITY_LABELS, PRIORITY_ORDER, type Priority } from "@/lib/types";
import { dayMonth } from "@/lib/format";

const PRIORITY_TONE: Record<Priority, string> = {
  urgent: "var(--color-danger)",
  high: "var(--color-warn)",
  standard: "var(--color-ink-3)",
};

/**
 * The "Other" board: open tasks in columns by priority, finished ones in a
 * collapsed list underneath. Clicking a card opens the details — what to do
 * and the best way to do it — in a dialog, so the board itself stays scannable.
 */
export function VaTaskBoard({ tasks, canManage }: { tasks: VaTask[]; canManage: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const open = tasks.filter((t) => t.status === "todo");
  const done = tasks.filter((t) => t.status === "done");
  const current = tasks.find((t) => t.id === openId) ?? null;

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hi"
          >
            <IconPlus size={14} />
            New task
          </button>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        {PRIORITY_ORDER.map((p) => {
          const items = open
            .filter((t) => t.priority === p)
            // Soonest due first; undated last.
            .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
          return (
            <section key={p} className="flex min-h-[8rem] flex-col rounded-xl border border-line bg-panel p-2">
              <div className="mb-2 flex items-center gap-2 px-1.5 pt-1">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: PRIORITY_TONE[p] }}
                />
                <h3 className="text-sm font-semibold">{PRIORITY_LABELS[p]}</h3>
                <span className="ml-auto rounded-md bg-raised px-1.5 py-0.5 text-[11px] tabular-nums text-ink-3">
                  {items.length}
                </span>
              </div>
              <div className="flex-1 space-y-1.5">
                {items.length === 0 ? (
                  <p className="px-2 py-4 text-center text-[11px] text-ink-3">Nothing here</p>
                ) : (
                  items.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setOpenId(t.id)}
                      className="block w-full space-y-1 rounded-lg border border-line bg-card px-3 py-2.5 text-left transition hover:border-line-strong hover:bg-raised"
                    >
                      <span className="block text-sm font-medium leading-snug">{t.title}</span>
                      {t.due_date ? (
                        <span className="flex items-center gap-1 text-[11px] text-ink-3">
                          <IconClock size={11} />
                          Due {dayMonth(t.due_date)}
                        </span>
                      ) : null}
                    </button>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>

      {done.length > 0 ? (
        <section>
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="text-xs text-ink-3 hover:text-ink-2"
          >
            {showDone ? "Hide" : "Show"} {done.length} finished
          </button>
          {showDone ? (
            <div className="mt-2 overflow-hidden rounded-xl border border-line bg-card">
              {done.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setOpenId(t.id)}
                  className="flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left text-sm text-ink-3 last:border-0 hover:bg-hover/40"
                >
                  <span className="text-ok">
                    <IconCheck size={12} />
                  </span>
                  <span className="min-w-0 flex-1 truncate line-through">{t.title}</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {tasks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-12 text-center text-sm text-ink-3">
          {canManage ? "No tasks yet — add one for the VA." : "Nothing to do here right now."}
        </p>
      ) : null}

      {current ? (
        <TaskDialog key={current.id} task={current} canManage={canManage} onClose={() => setOpenId(null)} />
      ) : null}
      {creating ? <TaskDialog task={null} canManage onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function TaskDialog({
  task,
  canManage,
  onClose,
}: {
  task: VaTask | null;
  canManage: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTrackedTransition();
  const [editing, setEditing] = useState(task === null);
  const [title, setTitle] = useState(task?.title ?? "");
  const [details, setDetails] = useState(task?.details ?? "");
  const [link, setLink] = useState(task?.link ?? "");
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "standard");
  const [due, setDue] = useState(task?.due_date ?? "");

  function run(fn: () => Promise<{ error?: string } | undefined | void>, ok: string, close = true) {
    startTransition(async () => {
      const res = await fn();
      if (res && "error" in res && res.error) toast.error(res.error);
      else {
        toast.success(ok);
        if (close) onClose();
        router.refresh();
      }
    });
  }

  const input = { title, details, link, priority, due_date: due || null };

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={task ? "Task details" : "New task"}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-line bg-card p-6 shadow-2xl"
      >
        {editing ? (
          <>
            <h2 className="text-base font-semibold">{task ? "Edit task" : "New task"}</h2>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
              className="w-full rounded-lg border border-line bg-raised px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={6}
              placeholder="The details — and the best way to do it."
              className="w-full resize-y rounded-lg border border-line bg-raised px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Link (optional) — https://…"
              className="w-full rounded-lg border border-line bg-raised px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
            <div className="flex flex-wrap gap-3">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                  Priority
                </span>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Priority)}
                  className="rounded-lg border border-line bg-raised px-3 py-2 text-sm focus:border-accent focus:outline-none"
                >
                  {PRIORITY_ORDER.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                  Due (optional)
                </span>
                <input
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                  className="rounded-lg border border-line bg-raised px-3 py-2 text-sm [color-scheme:dark] focus:border-accent focus:outline-none"
                />
              </label>
            </div>
            <div className="flex justify-between gap-2">
              {task ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm("Delete this task?")) {
                      run(() => deleteVaTaskAction(task.id), "Task deleted.");
                    }
                  }}
                  className="rounded-lg px-3 py-1.5 text-sm text-danger hover:bg-danger/10"
                >
                  Delete
                </button>
              ) : (
                <span />
              )}
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={task ? () => setEditing(false) : onClose}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-hover"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={pending || !title.trim()}
                  onClick={() =>
                    run(
                      () => (task ? updateVaTaskAction(task.id, input) : createVaTaskAction(input)),
                      task ? "Saved." : "Task added."
                    )
                  }
                  className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hi disabled:opacity-40"
                >
                  {pending ? "Saving…" : "Save"}
                </button>
              </span>
            </div>
          </>
        ) : task ? (
          <>
            <div className="flex items-start gap-2">
              <h2 className="min-w-0 flex-1 text-base font-semibold leading-snug">{task.title}</h2>
              <span
                className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
                style={{
                  color: PRIORITY_TONE[task.priority],
                  background: `color-mix(in srgb, ${PRIORITY_TONE[task.priority]} 14%, transparent)`,
                }}
              >
                {PRIORITY_LABELS[task.priority]}
              </span>
            </div>
            {task.due_date ? (
              <p className="flex items-center gap-1 text-xs text-ink-3">
                <IconClock size={12} />
                Due {dayMonth(task.due_date)}
              </p>
            ) : null}
            {task.details ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{task.details}</p>
            ) : (
              <p className="text-sm text-ink-3">No extra details.</p>
            )}
            {task.link ? (
              <a
                href={task.link}
                target="_blank"
                rel="noreferrer"
                className="block truncate text-sm text-accent-hi hover:underline"
              >
                {task.link}
              </a>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              {canManage ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-hover"
                >
                  Edit
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-hover"
              >
                Close
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(
                    () => setVaTaskDoneAction(task.id, task.status !== "done"),
                    task.status === "done" ? "Back on the list." : "Marked done."
                  )
                }
                className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hi disabled:opacity-40"
              >
                {task.status === "done" ? "Reopen" : "Mark done"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
