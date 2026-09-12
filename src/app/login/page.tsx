"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    params.get("inactive") ? "That account has been deactivated. Ask the Owner to re-enable it." : null
  );
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setPending(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-sm bg-card border border-line rounded-2xl p-8 shadow-xl"
    >
      <h1 className="text-xl font-semibold mb-1">Content Ops</h1>
      <p className="text-sm text-ink-2 mb-6">Sign in to your account.</p>

      <label className="block text-xs font-medium text-ink-2 mb-1">Email</label>
      <input
        type="email"
        autoComplete="email"
        autoFocus
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-lg bg-raised border border-line-strong px-3 py-2.5 mb-3 outline-none focus:border-accent"
      />

      <label className="block text-xs font-medium text-ink-2 mb-1">Password</label>
      <input
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded-lg bg-raised border border-line-strong px-3 py-2.5 mb-3 outline-none focus:border-accent"
      />

      {error ? <p className="text-sm text-danger mb-3">{error}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-accent text-white font-medium py-2.5 hover:bg-accent-hi transition disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
