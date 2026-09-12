"use client";

import { useRouter } from "next/navigation";
import { markAllReadAction } from "@/app/notification-actions";

export function MarkAllRead() {
  const router = useRouter();
  return (
    <button
      onClick={() => markAllReadAction().then(() => router.refresh())}
      className="text-sm text-ink-2 hover:text-ink"
    >
      Mark all read
    </button>
  );
}
