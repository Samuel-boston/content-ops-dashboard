"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md rounded-xl border border-line bg-app p-6 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-1.5 text-sm text-ink-2">
        {error.message || "An unexpected error occurred loading this page."}
      </p>
      {error.digest ? (
        <p className="mt-1 font-mono text-[11px] text-ink-3">ref {error.digest}</p>
      ) : null}
      <button
        onClick={reset}
        className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hi"
      >
        Try again
      </button>
    </div>
  );
}
