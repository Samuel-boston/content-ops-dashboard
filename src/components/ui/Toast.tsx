"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastCtx = createContext<{
  push: (message: string, kind?: ToastKind) => void;
}>({ push: () => {} });

/** `const toast = useToast(); toast.error("…")` — replaces window.alert. */
export function useToast() {
  const { push } = useContext(ToastCtx);
  return {
    success: (m: string) => push(m, "success"),
    error: (m: string) => push(m, "error"),
    info: (m: string) => push(m, "info"),
    /** Convenience for server-action results: shows the error, returns ok-ness. */
    result: (r: { ok?: boolean; error?: string } | undefined | void, okMessage?: string) => {
      const res = r as { ok?: boolean; error?: string } | undefined;
      if (res?.error) {
        push(res.error, "error");
        return false;
      }
      if (okMessage) push(okMessage, "success");
      return true;
    },
  };
}

const STYLES: Record<ToastKind, string> = {
  success: "border-ok/40 bg-ok/10 text-ok",
  error: "border-danger/40 bg-danger/10 text-danger",
  info: "border-line-strong bg-card text-ink",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, kind: ToastKind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, message }]);
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={() => setToasts((s) => s.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastItem({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), 4200);
    const t2 = setTimeout(onDone, 4600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [onDone]);

  return (
    <div
      role="status"
      className={`pointer-events-auto rounded-lg border px-3 py-2 text-sm shadow-lg transition-all duration-300 ${
        STYLES[toast.kind]
      } ${leaving ? "translate-y-1 opacity-0" : "translate-y-0 opacity-100"}`}
    >
      <div className="flex items-start gap-2">
        <span className="flex-1">{toast.message}</span>
        <button onClick={onDone} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Dismiss">
          ×
        </button>
      </div>
    </div>
  );
}
