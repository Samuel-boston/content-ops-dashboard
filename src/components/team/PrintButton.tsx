"use client";

/** Print is a browser action, so it needs a client component to call it. */
export function PrintButton({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={`rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:bg-hover hover:text-ink ${className}`}
    >
      Print / save as PDF
    </button>
  );
}
