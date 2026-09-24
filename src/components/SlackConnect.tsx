"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  connectSlackAction,
  disconnectSlackAction,
  listSlackChannelsAction,
  setSlackAnnounceAction,
  setSlackChannelAction,
  testSlackAction,
} from "@/app/slack-actions";
import { slackManifest } from "@/lib/slack-manifest";

/**
 * Slack, in three steps: create the app from a manifest (one paste — every
 * permission and address is in it), paste the two values Slack gives back, pick a
 * channel. It saves itself, so there's no second Save button to forget.
 */
export function SlackConnect({
  connected,
  team,
  channelId,
  channelName,
  announce,
  appUrl,
}: {
  connected: boolean;
  team: string | null;
  channelId: string | null;
  channelName: string | null;
  announce: boolean;
  /** This dashboard's address, from the server. Falls back to the browser's. */
  appUrl: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [token, setToken] = useState("");
  const [secret, setSecret] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [channels, setChannels] = useState<{ id: string; name: string }[] | null>(null);
  const [pick, setPick] = useState(channelId ?? "");
  const [copied, setCopied] = useState(false);
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));
  const [on, setOn] = useState(announce);

  const base = appUrl || origin;
  const manifest = JSON.stringify(slackManifest(base || "https://YOUR-SITE.vercel.app"), null, 2);

  const cls = "w-full rounded-lg bg-raised border border-line-strong px-3 py-2 text-sm outline-none focus:border-accent";
  const btn = "rounded-lg border border-line-strong px-3 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50";

  useEffect(() => {
    if (!connected) return;
    let alive = true;
    void listSlackChannelsAction().then((c) => {
      if (alive) setChannels(c);
    });
    return () => {
      alive = false;
    };
  }, [connected]);

  async function copyManifest() {
    try {
      await navigator.clipboard.writeText(manifest);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMsg({ ok: false, text: "Couldn't copy — select the text in the box and copy it by hand." });
    }
  }

  function connect() {
    setMsg(null);
    start(async () => {
      const r = await connectSlackAction({ botToken: token, signingSecret: secret });
      if (!r.ok) return setMsg({ ok: false, text: r.message });
      setToken("");
      setSecret("");
      setMsg({ ok: true, text: `Connected to ${r.team}. Now pick a channel.` });
      router.refresh();
    });
  }

  function choose(id: string) {
    setPick(id);
    const c = channels?.find((x) => x.id === id);
    if (!c) return;
    start(async () => {
      const r = await setSlackChannelAction(c);
      setMsg({ ok: r.ok, text: r.message });
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-line bg-app p-4 space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-line-strong"}`} />
        Slack <span className="text-ink-3">— ask the dashboard from Slack, and hear what moves</span>
      </h2>

      {connected ? (
        <>
          <p className="text-sm text-ink-2">
            Connected to <span className="text-ink">{team ?? "Slack"}</span>. In Slack, type{" "}
            <code className="rounded bg-raised px-1 text-xs">/ops how many in scripting</code>,{" "}
            <code className="rounded bg-raised px-1 text-xs">/ops add idea: …</code>, or @-mention the bot or message it directly.
          </p>

          <label className="block text-xs text-ink-2">
            Announce in this channel
            <select value={pick} onChange={(e) => choose(e.target.value)} disabled={pending || !channels} className={`${cls} mt-1`}>
              <option value="">{channels ? "Choose a channel…" : "Loading channels…"}</option>
              {channelName && !channels?.some((c) => c.id === channelId) && channelId ? <option value={channelId}>#{channelName}</option> : null}
              {(channels ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-start gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={on}
              onChange={(e) => {
                setOn(e.target.checked);
                start(async () => {
                  await setSlackAnnounceAction(e.target.checked);
                });
              }}
              className="mt-1 accent-accent"
            />
            <span>
              Post updates to that channel
              <span className="block text-[11px] text-ink-3">A script is done, something is ready to review, a video is approved and with the VA, a video is posted.</span>
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={pending} onClick={() =>
                start(async () => {
                  const r = await testSlackAction();
                  setMsg({ ok: r.ok, text: r.message });
                })
              } className={btn}>
              Send a test message
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await disconnectSlackAction();
                  setMsg(null);
                  router.refresh();
                })
              }
              className={btn}
            >
              Disconnect
            </button>
          </div>
          <p className="text-[11px] text-ink-3">
            People are recognised by the email on their Slack profile, so each person needs a seat in the dashboard (Team → Seats) with that email.
          </p>
        </>
      ) : (
        <>
          <ol className="list-decimal space-y-2 pl-5 text-xs leading-relaxed text-ink-2">
            <li>
              Press <b>Copy the app manifest</b>, then go to{" "}
              <a className="text-accent-hi underline" href="https://api.slack.com/apps?new_app=1" target="_blank" rel="noopener noreferrer">
                api.slack.com/apps
              </a>{" "}
              → <b>Create New App</b> → <b>From a manifest</b>. Pick your workspace, paste, and press <b>Create</b>.
            </li>
            <li>
              On the app&rsquo;s page press <b>Install to Workspace</b> and allow it. Then copy two things: the <b>Signing Secret</b> (Basic
              Information) and the <b>Bot User OAuth Token</b> (OAuth &amp; Permissions, starts with <code>xoxb-</code>).
            </li>
            <li>Paste them below and press <b>Connect</b>.</li>
          </ol>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={copyManifest} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hi">
              {copied ? "Copied" : "Copy the app manifest"}
            </button>
            <span className="text-[11px] text-ink-3">Includes this dashboard&rsquo;s address, the /ops command and every permission.</span>
          </div>
          <details className="text-[11px] text-ink-3">
            <summary className="cursor-pointer">Show the manifest</summary>
            <textarea readOnly value={manifest} rows={8} className="mt-1.5 w-full resize-none rounded-lg border border-line bg-raised p-2 font-mono text-[10px]" onFocus={(e) => e.currentTarget.select()} />
          </details>

          <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Bot User OAuth Token (xoxb-…)" className={cls} />
          <input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Signing Secret" className={cls} />
          <button
            type="button"
            disabled={pending || !token.trim() || !secret.trim()}
            onClick={connect}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hi disabled:opacity-50"
          >
            {pending ? "Connecting…" : "Connect"}
          </button>
        </>
      )}

      {msg?.text ? <p className={`text-xs ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p> : null}
    </section>
  );
}
