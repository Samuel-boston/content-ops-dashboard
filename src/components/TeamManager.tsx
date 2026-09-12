"use client";

import { useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import {
  inviteUserAction,
  setUserActiveAction,
  setUserRoleAction,
} from "@/app/actions";
import type { Profile, Role } from "@/lib/types";

export function TeamManager({ team, viewer }: { team: Profile[]; viewer: Profile }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTrackedTransition();
  const viewerIsOwner = viewer.role === "owner";

  function run(fn: () => Promise<{ error?: string } | void>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  }

  const canEdit = (target: Profile) => {
    if (target.id === viewer.id) return false;
    if (target.role === "owner") return false;
    if (target.role === "admin" && !viewerIsOwner) return false;
    return true;
  };

  const field =
    "rounded-lg bg-raised border border-line-strong px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <div className="space-y-6">
      <form
        action={(fd) => run(() => inviteUserAction(fd))}
        className="rounded-xl border border-line bg-app p-5 space-y-3"
      >
        <h2 className="text-sm font-semibold">Add a seat</h2>
        <div className="flex flex-wrap gap-2">
          <input name="full_name" required placeholder="Name" className={`${field} flex-1 min-w-[140px]`} />
          <input name="email" type="email" required placeholder="Email" className={`${field} flex-1 min-w-[180px]`} />
          <input
            name="password"
            required
            placeholder="Temp password (8+)"
            className={`${field} min-w-[160px]`}
          />
          <select name="role" defaultValue="editor" className={field}>
            <option value="editor">Editor</option>
            {viewerIsOwner ? <option value="admin">Admin</option> : null}
          </select>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-accent text-white font-medium px-4 py-2 text-sm hover:bg-accent-hi disabled:opacity-60"
          >
            Add
          </button>
        </div>
        {!viewerIsOwner ? (
          <p className="text-xs text-ink-3">Only the Owner can add Admin seats.</p>
        ) : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </form>

      <div className="rounded-xl border border-line bg-app overflow-hidden">
        {team.map((m) => (
          <div
            key={m.id}
            className={`flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-0 ${
              m.active ? "" : "opacity-50"
            }`}
          >
            <div className="min-w-[180px] flex-1">
              <div className="text-sm font-medium">
                {m.full_name || m.email}
                {m.id === viewer.id ? <span className="text-ink-3"> (you)</span> : null}
              </div>
              <div className="text-xs text-ink-3">{m.email}</div>
            </div>

            {canEdit(m) ? (
              <select
                value={m.role}
                onChange={(e) => run(() => setUserRoleAction(m.id, e.target.value as Role))}
                disabled={pending}
                className={field}
              >
                <option value="editor">Editor</option>
                {viewerIsOwner ? <option value="admin">Admin</option> : null}
              </select>
            ) : (
              <span className="rounded-md border border-line-strong bg-raised px-2 py-1 text-xs capitalize">
                {m.role}
              </span>
            )}

            {canEdit(m) ? (
              <button
                onClick={() => run(() => setUserActiveAction(m.id, !m.active))}
                disabled={pending}
                className="text-xs text-ink-2 hover:text-ink"
              >
                {m.active ? "Deactivate" : "Reactivate"}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
