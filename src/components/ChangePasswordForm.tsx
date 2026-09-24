"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { useToast } from "@/components/ui/Toast";

export function ChangePasswordForm() {
  const toast = useToast();
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cls = "w-full rounded-lg border border-line-strong bg-raised px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (pw.length < 10) return setError("Use 10 or more characters — a few words strung together works well.");
        if (pw !== again) return setError("The two passwords don't match.");
        setBusy(true);
        const { error: err } = await supabaseBrowser().auth.updateUser({ password: pw });
        setBusy(false);
        if (err) return setError(err.message);
        setPw("");
        setAgain("");
        toast.success("Password changed.");
      }}
      className="space-y-3 rounded-xl border border-line bg-app p-4"
    >
      <h2 className="text-sm font-semibold">Change password</h2>
      <div>
        <label className="mb-1 block text-xs font-medium text-ink-2">New password</label>
        <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className={cls} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-ink-2">Type it again</label>
        <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={cls} />
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      <button
        disabled={busy}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hi disabled:opacity-50"
      >
        {busy ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
