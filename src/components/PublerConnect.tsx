"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  choosePublerAccountAction,
  connectPublerAction,
  disconnectPublerAction,
  setPublerTrialModeAction,
  testPublerAction,
  type PublerChoice,
} from "@/app/publer-actions";

/**
 * Connect Publer: paste one API key and press Connect. The Instagram account is
 * read from Publer and chosen automatically when there's only one. Lives outside
 * the big settings form on purpose — it saves itself, so there's no second
 * Save button to forget.
 */
export function PublerConnect({
  connected,
  hasKey,
  accountName,
  trialMode,
}: {
  connected: boolean;
  hasKey: boolean;
  accountName: string | null;
  trialMode: "MANUAL" | "SS_PERFORMANCE";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [choices, setChoices] = useState<PublerChoice[] | null>(null);
  const [changing, setChanging] = useState(false);
  const [mode, setMode] = useState(trialMode);

  const cls =
    "w-full rounded-lg bg-raised border border-line-strong px-3 py-2 text-sm outline-none focus:border-accent";
  const btn =
    "rounded-lg border border-line-strong px-3 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50";

  function connect() {
    setMsg(null);
    start(async () => {
      const r = await connectPublerAction(key);
      if (!r.ok) return setMsg({ ok: false, text: r.message });
      if (r.connected) {
        setKey("");
        setChoices(null);
        setChanging(false);
        setMsg({ ok: true, text: `Connected to ${r.accountName}.` });
        router.refresh();
      } else {
        setChoices(r.choices);
        setMsg({ ok: true, text: "The key works. Pick the Instagram account to post to." });
      }
    });
  }

  function choose(c: PublerChoice) {
    start(async () => {
      const r = await choosePublerAccountAction({ workspaceId: c.workspaceId, accountId: c.accountId });
      if (!r.ok) return setMsg({ ok: false, text: r.message });
      setChoices(null);
      setChanging(false);
      setMsg({ ok: true, text: r.connected ? `Connected to ${r.accountName}.` : "" });
      router.refresh();
    });
  }

  function test() {
    setMsg(null);
    start(async () => {
      const r = await testPublerAction();
      setMsg({ ok: r.ok, text: r.message });
    });
  }

  function disconnect() {
    start(async () => {
      await disconnectPublerAction();
      setMsg(null);
      setChoices(null);
      router.refresh();
    });
  }

  function changeMode(next: "MANUAL" | "SS_PERFORMANCE") {
    setMode(next);
    start(async () => {
      const r = await setPublerTrialModeAction(next);
      if ("error" in r && r.error) setMsg({ ok: false, text: r.error });
    });
  }

  const showConnected = connected && !changing;

  return (
    <section className="rounded-xl border border-line bg-app p-4 space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-line-strong"}`} />
        Publer <span className="text-ink-3">— post and schedule Reels, including trial reels</span>
      </h2>

      {showConnected ? (
        <>
          <p className="text-sm text-ink-2">
            Connected to Instagram{accountName ? <> · <span className="text-ink">{accountName}</span></> : null}. Reels and trial
            reels are posted from the VA&rsquo;s desk and the Post tab. No Meta app is needed.
          </p>

          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-2">After a trial reel is posted</p>
            <div className="space-y-1.5">
              {(
                [
                  ["MANUAL", "Keep it a trial until I promote it", "You decide from the archive after the numbers are in."],
                  ["SS_PERFORMANCE", "Let Instagram share it to followers if it does well", "Instagram graduates it automatically when the trial performs."],
                ] as const
              ).map(([value, label, hint]) => (
                <label key={value} className="flex items-start gap-2 text-sm text-ink-2">
                  <input
                    type="radio"
                    name="publer_trial_mode"
                    checked={mode === value}
                    onChange={() => changeMode(value)}
                    className="mt-1 accent-accent"
                  />
                  <span>
                    {label}
                    <span className="block text-[11px] text-ink-3">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={pending} onClick={test} className={btn}>
              {pending ? "Checking…" : "Test the connection"}
            </button>
            <button type="button" disabled={pending} onClick={() => { setChanging(true); setMsg(null); }} className={btn}>
              Change account or key
            </button>
            <button type="button" disabled={pending} onClick={disconnect} className={btn}>
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-xs leading-relaxed text-ink-2">
            <li>
              In Publer open <b>Settings → Access &amp; Login → API Keys</b> and press <b>Create API Key</b> (needs a Business
              plan). Tick <b>workspaces, accounts, posts and media</b>, then copy the key.
            </li>
            <li>Make sure your Instagram account is added in Publer (Social Accounts).</li>
            <li>Paste the key below and press <b>Connect</b>. That&rsquo;s all — nothing else to fill in.</li>
          </ol>
          <div className="flex gap-2">
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={hasKey ? "Paste a new key to replace the saved one" : "Paste the Publer API key"}
              className={cls}
            />
            <button
              type="button"
              disabled={pending || !key.trim()}
              onClick={connect}
              className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hi disabled:opacity-50"
            >
              {pending ? "Connecting…" : "Connect"}
            </button>
          </div>
          {changing ? (
            <button type="button" onClick={() => { setChanging(false); setChoices(null); setMsg(null); }} className="text-xs text-ink-3 underline">
              Cancel
            </button>
          ) : null}
        </>
      )}

      {choices ? (
        <div className="space-y-1.5">
          {choices.map((c) => (
            <button
              key={`${c.workspaceId}:${c.accountId}`}
              type="button"
              disabled={pending}
              onClick={() => choose(c)}
              className="flex w-full items-center justify-between rounded-lg border border-line bg-card px-3 py-2 text-left text-sm hover:border-accent"
            >
              <span>{c.accountName}</span>
              <span className="text-[11px] text-ink-3">{c.workspaceName}</span>
            </button>
          ))}
        </div>
      ) : null}

      {msg?.text ? <p className={`text-xs ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p> : null}
    </section>
  );
}
