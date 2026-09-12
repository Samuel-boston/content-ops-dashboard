"use client";

import { useState } from "react";

/**
 * A real confirm dialog — `window.confirm` is blocked in some embedded
 * browsers and looks broken on mobile.
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: "Delete?", danger: true })) …
 */
export function useConfirm() {
  const [state, setState] = useState<{
    open: boolean;
    opts: ConfirmOptions;
    resolve?: (v: boolean) => void;
  }>({ open: false, opts: { title: "" } });

  const confirm = (opts: ConfirmOptions) =>
    new Promise<boolean>((resolve) => setState({ open: true, opts, resolve }));

  const close = (v: boolean) => {
    state.resolve?.(v);
    setState((s) => ({ ...s, open: false }));
  };

  const dialog = state.open ? (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 px-4"
      onClick={() => close(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-line bg-card p-5"
      >
        <h2 className="text-base font-semibold">{state.opts.title}</h2>
        {state.opts.body ? (
          <p className="mt-1.5 text-sm text-ink-2">{state.opts.body}</p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => close(false)}
            className="rounded-lg border border-line-strong px-3 py-1.5 text-sm hover:bg-hover"
          >
            {state.opts.cancelLabel ?? "Cancel"}
          </button>
          <button
            onClick={() => close(true)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              state.opts.danger
                ? "bg-danger text-white hover:brightness-110"
                : "bg-accent text-white hover:bg-accent-hi"
            }`}
          >
            {state.opts.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/**
 * Declarative form of the same dialog, for callers that already hold the
 * pending item in state rather than awaiting a promise.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal
      aria-label={title}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 px-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-line bg-card p-5 shadow-2xl"
      >
        <h2 className="text-base font-semibold">{title}</h2>
        {body ? <p className="mt-1.5 text-sm text-ink-2">{body}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-hover"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-danger px-3 py-1.5 text-sm font-medium text-white hover:brightness-110"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
