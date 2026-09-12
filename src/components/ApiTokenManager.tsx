"use client";

import { useState, useTransition } from "react";
import {
  createApiTokenAction,
  revokeApiTokenAction,
  type ApiTokenRow,
} from "@/app/ai-connect-actions";
import { IconTrash } from "@/components/ui/icons";

function fmt(iso: string | null) {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function ApiTokenManager({ tokens }: { tokens: ApiTokenRow[] }) {
  const [list, setList] = useState(tokens);
  const [label, setLabel] = useState("");
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const create = () => {
    startTransition(async () => {
      const r = await createApiTokenAction(label);
      if (r?.token) {
        setFreshToken(r.token);
        setLabel("");
        setCopied(false);
        const r2 = await import("@/app/ai-connect-actions").then((m) => m.listApiTokensAction());
        setList(r2);
      }
    });
  };

  const revoke = (id: string) => {
    startTransition(async () => {
      await revokeApiTokenAction(id);
      setList((l) => l.filter((t) => t.id !== id));
    });
  };

  return (
    <div className="space-y-4">
      {freshToken ? (
        <div className="rounded-lg border border-accent/40 bg-accent/5 p-3 space-y-2">
          <p className="text-xs font-medium text-ink-1">
            Copy this now — it won&rsquo;t be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md bg-raised px-2 py-1.5 text-xs">{freshToken}</code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(freshToken);
                setCopied(true);
              }}
              className="shrink-0 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white hover:bg-accent-hi"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label — e.g. “My Claude”"
          className="flex-1 rounded-lg bg-raised border border-line-strong px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="button"
          disabled={pending}
          onClick={create}
          className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hi disabled:opacity-50"
        >
          Generate token
        </button>
      </div>

      {list.length ? (
        <div className="overflow-hidden rounded-lg border border-line">
          {list.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-ink-1">{t.label}</p>
                <p className="text-[11px] text-ink-3">
                  created {fmt(t.created_at)} · last used {fmt(t.last_used_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => revoke(t.id)}
                className="shrink-0 rounded-md p-1.5 text-ink-3 hover:bg-raised hover:text-danger"
                title="Revoke"
              >
                <IconTrash size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-ink-3">No tokens yet.</p>
      )}
    </div>
  );
}
