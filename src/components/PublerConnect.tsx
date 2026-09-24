"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  choosePublerAccountsAction,
  connectPublerAction,
  disconnectPublerAction,
  setPublerTrialModeAction,
  testPublerAction,
  type PublerWorkspaceOption,
} from "@/app/publer-actions";

const LABEL: Record<string, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", linkedin: "LinkedIn" };

/**
 * Connect Publer: paste one API key and press Connect. The workspace and the
 * Instagram / YouTube / TikTok / LinkedIn accounts are read from Publer and
 * chosen automatically when there's only one of each. Lives outside the big
 * settings form on purpose — it saves itself, so there's no second Save button
 * to forget.
 */
export function PublerConnect({
  connected,
  hasKey,
  accounts,
  trialMode,
}: {
  connected: boolean;
  hasKey: boolean;
  /** Network -> account name, for what's saved. */
  accounts: Record<string, string>;
  trialMode: "MANUAL" | "SS_PERFORMANCE";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [options, setOptions] = useState<PublerWorkspaceOption[] | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [changing, setChanging] = useState(false);
  const [mode, setMode] = useState(trialMode);

  const cls =
    "w-full rounded-lg bg-raised border border-line-strong px-3 py-2 text-sm outline-none focus:border-accent";
  const btn =
    "rounded-lg border border-line-strong px-3 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50";

  function showOptions(workspaces: PublerWorkspaceOption[]) {
    setOptions(workspaces);
    const first = workspaces[0];
    setWorkspaceId(first.workspaceId);
    setPicks(defaultPicks(first));
  }

  function defaultPicks(ws: PublerWorkspaceOption) {
    const out: Record<string, string> = {};
    for (const a of ws.accounts) if (!out[a.network]) out[a.network] = a.accountId;
    return out;
  }

  function connect() {
    setMsg(null);
    start(async () => {
      const r = await connectPublerAction(key);
      if (!r.ok) return setMsg({ ok: false, text: r.message });
      if (r.connected) {
        setKey("");
        setOptions(null);
        setChanging(false);
        setMsg({ ok: true, text: `Connected: ${r.summary}.` });
        router.refresh();
      } else {
        showOptions(r.workspaces);
        setMsg({ ok: true, text: "The key works. Choose what to post to." });
      }
    });
  }

  function saveChoice() {
    start(async () => {
      const r = await choosePublerAccountsAction({ workspaceId, accounts: picks });
      if (!r.ok) return setMsg({ ok: false, text: r.message });
      setOptions(null);
      setChanging(false);
      setMsg({ ok: true, text: r.connected ? `Connected: ${r.summary}.` : "" });
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
      setOptions(null);
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
  const ws = options?.find((w) => w.workspaceId === workspaceId) ?? null;
  const networks = ws ? [...new Set(ws.accounts.map((a) => a.network))] : [];

  return (
    <section className="rounded-xl border border-line bg-app p-4 space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-line-strong"}`} />
        Publer <span className="text-ink-3">— post and schedule Reels, trial reels, YouTube and more</span>
      </h2>

      {showConnected ? (
        <>
          <ul className="space-y-1 text-sm text-ink-2">
            {Object.entries(accounts).map(([n, name]) => (
              <li key={n} className="flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="w-20 shrink-0 text-ink-3">{LABEL[n] ?? n}</span>
                <span className="text-ink">{name || "connected"}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-3">
            Reels, trial reels and YouTube Shorts are posted from the VA&rsquo;s desk and the Post tab. No Meta app is needed.
          </p>

          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-2">After an Instagram trial reel is posted</p>
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
              Change accounts or key
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
            <li>Make sure the accounts you post from are added in Publer (Social Accounts): Instagram, YouTube, TikTok or LinkedIn.</li>
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
            <button type="button" onClick={() => { setChanging(false); setOptions(null); setMsg(null); }} className="text-xs text-ink-3 underline">
              Cancel
            </button>
          ) : null}
        </>
      )}

      {options && ws ? (
        <div className="space-y-2 rounded-lg border border-line bg-card p-3">
          {options.length > 1 ? (
            <label className="block text-xs text-ink-2">
              Workspace
              <select
                value={workspaceId}
                onChange={(e) => {
                  setWorkspaceId(e.target.value);
                  const next = options.find((w) => w.workspaceId === e.target.value);
                  if (next) setPicks(defaultPicks(next));
                }}
                className={`${cls} mt-1`}
              >
                {options.map((w) => (
                  <option key={w.workspaceId} value={w.workspaceId}>
                    {w.workspaceName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {networks.map((n) => {
            const list = ws.accounts.filter((a) => a.network === n);
            return (
              <label key={n} className="flex items-center gap-2 text-xs text-ink-2">
                <span className="w-20 shrink-0">{LABEL[n] ?? n}</span>
                <select
                  value={picks[n] ?? ""}
                  onChange={(e) => setPicks((p) => ({ ...p, [n]: e.target.value }))}
                  className={cls}
                >
                  <option value="">Don&rsquo;t post here</option>
                  {list.map((a) => (
                    <option key={a.accountId} value={a.accountId}>
                      {a.accountName}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          <button
            type="button"
            disabled={pending}
            onClick={saveChoice}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hi disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      ) : null}

      {msg?.text ? <p className={`text-xs ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p> : null}
    </section>
  );
}
