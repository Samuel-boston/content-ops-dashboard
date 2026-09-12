"use client";

import { useRouter, useSearchParams } from "next/navigation";

export function Pager({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;

  function go(p: number) {
    const next = new URLSearchParams(params);
    next.set("page", String(p));
    router.replace(`?${next.toString()}`);
  }

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex items-center justify-between text-sm text-ink-2">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex gap-1">
        <button
          onClick={() => go(page - 1)}
          disabled={page <= 1}
          className="rounded-md border border-line-strong px-2 py-1 disabled:opacity-40 hover:bg-hover"
        >
          Prev
        </button>
        <span className="px-2 py-1">
          {page} / {pages}
        </span>
        <button
          onClick={() => go(page + 1)}
          disabled={page >= pages}
          className="rounded-md border border-line-strong px-2 py-1 disabled:opacity-40 hover:bg-hover"
        >
          Next
        </button>
      </div>
    </div>
  );
}
