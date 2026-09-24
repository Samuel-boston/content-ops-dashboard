"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useToast } from "@/components/ui/Toast";
import {
  createStarterDocsAction,
  getResearchSetupAction,
  saveResearchSettingsAction,
  testResearchWebhookAction,
  type ResearchSetup,
} from "@/app/research-actions";

const skillText = (appUrl: string) => `---
name: content-ops-weekly-research
description: Find viral short-form content in the client's niche and add it to their Content Ops dashboard. Use on Mondays, or when asked to research what's working.
---

1. Read the client's offer and ideal client with the Content Ops connector: list_playbook_docs, then get_playbook_doc.
2. Check what is already saved with list_top_posts.
3. Use the browser to search Instagram, TikTok and YouTube Shorts for posts from the last 30 days that got far more views than that account usually gets and fit the ideal client.
4. For each keep: topic, exact opening hook, views as shown on the page, link, platform, creator. Never invent numbers.
5. Add the best 8 to 10 with add_top_posts (source: inspiration). If the connector is missing, output a table to paste into ${appUrl || "the dashboard"}/library/top-posts.
6. End with the patterns the winners share and one idea to film this week.
`;

/** Owner tools for the Monday research routine: the prompt, one-click chats, an optional webhook, and the AI hookups. */
export function ResearchAutomation() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTrackedTransition();
  const [s, setS] = useState<ResearchSetup | null>(null);
  const [prompt, setPrompt] = useState("");
  const [autoAdd, setAutoAdd] = useState(true);
  const [hook, setHook] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getResearchSetupAction().then((r) => {
      if (!alive) return;
      setS(r);
      setPrompt(r.prompt);
      setAutoAdd(r.autoAdd);
      setHook(r.webhookUrl);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!s) return null;
  const cls = "w-full rounded-lg border border-line bg-raised px-2.5 py-1.5 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none";
  const btn = "rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50";
  const copy = (text: string, done = "Copied.") => void navigator.clipboard.writeText(text).then(() => toast.success(done), () => toast.error("Select the text and copy it by hand."));
  const links = { chatgpt: `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`, claude: `https://claude.ai/new?q=${encodeURIComponent(prompt)}` };

  function save(reset = false) {
    start(async () => {
      const r = await saveResearchSettingsAction({ prompt: reset ? null : prompt === s!.prompt && !s!.custom ? null : prompt, autoAdd, webhookUrl: hook });
      if ("error" in r && r.error) return toast.error(r.error);
      toast.success(reset ? "Back to the default prompt." : "Saved.");
      const fresh = await getResearchSetupAction();
      setS(fresh);
      setPrompt(fresh.prompt);
      router.refresh();
    });
  }

  return (
    <section className="space-y-3 rounded-xl border border-line bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold">Monday research, on autopilot</h2>
        <p className="text-[11px] text-ink-3">
          Every Monday the digest (email, Slack, Telegram) carries this prompt with buttons that open ChatGPT or Claude with it already typed in. The AI reads your offer and ideal client, browses for what&rsquo;s working, adds it to Top posts, and the next digest reports what it found.
        </p>
      </div>

      {!s.hasOfferDoc || !s.hasClientDoc ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">
          <span className="min-w-0 flex-1">The AI needs your offer and ideal client. Add them as docs in Library → SOP / Playbook.</span>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await createStarterDocsAction();
                if ("error" in r && r.error) return toast.error(r.error);
                toast.success("Created. Fill them in under SOP / Playbook.");
                setS(await getResearchSetupAction());
              })
            }
            className={btn}
          >
            Create the two docs
          </button>
        </div>
      ) : null}

      <label className="block text-xs text-ink-2">
        The prompt
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={10} className={`${cls} mt-1 font-mono text-xs leading-relaxed`} />
      </label>
      <label className="flex items-start gap-2 text-sm text-ink-2">
        <input type="checkbox" checked={autoAdd} onChange={(e) => setAutoAdd(e.target.checked)} className="mt-1 accent-accent" />
        <span>
          Let the AI add its best finds without asking first
          <span className="block text-[11px] text-ink-3">Off: it shows you the list and waits. Only applies to the default prompt.</span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <a href={links.chatgpt} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hi">
          Open in ChatGPT
        </a>
        <a href={links.claude} target="_blank" rel="noopener noreferrer" className={btn}>
          Open in Claude
        </a>
        <button type="button" onClick={() => copy(prompt)} className={btn}>
          Copy the prompt
        </button>
        <button type="button" disabled={pending} onClick={() => save(false)} className={btn}>
          {pending ? "Saving…" : "Save"}
        </button>
        {s.custom ? (
          <button type="button" disabled={pending} onClick={() => save(true)} className={btn}>
            Back to the default
          </button>
        ) : null}
      </div>

      <div className="space-y-1.5 border-t border-line pt-3">
        <label className="block text-xs text-ink-2">
          Weekly webhook (optional)
          <input value={hook} onChange={(e) => setHook(e.target.value)} placeholder="https://hooks.zapier.com/… or a Make / n8n address" className={`${cls} mt-1`} />
        </label>
        <p className="text-[11px] text-ink-3">
          Every Monday the dashboard sends this address a JSON message with the prompt and both one-click links, so Zapier, Make or n8n can post it, start a chat, or call an AI for you.
        </p>
        <div className="flex gap-2">
          <button type="button" disabled={pending || !hook.trim()} onClick={() => start(async () => { await saveResearchSettingsAction({ prompt: s.custom ? prompt : null, autoAdd, webhookUrl: hook }); const r = await testResearchWebhookAction(); setMsg(r.message); })} className={btn}>
            Send a test
          </button>
          {msg ? <span className="self-center text-xs text-ink-2">{msg}</span> : null}
        </div>
      </div>

      <details className="border-t border-line pt-3 text-xs text-ink-2">
        <summary className="cursor-pointer font-medium">Connect ChatGPT or Claude so it can read the docs and add posts</summary>
        <div className="mt-2 space-y-3">
          <div>
            <p className="font-medium text-ink">Claude</p>
            <p className="text-ink-3">Avatar menu → Connect AI: add the connector. Then save this as a skill so Claude runs the routine on request:</p>
            <textarea readOnly value={skillText(s.appUrl)} rows={8} onFocus={(e) => e.currentTarget.select()} className={`${cls} mt-1 font-mono text-[11px]`} />
            <button type="button" onClick={() => copy(skillText(s.appUrl), "Skill copied.")} className={`${btn} mt-1`}>
              Copy the skill
            </button>
          </div>
          <div>
            <p className="font-medium text-ink">ChatGPT (a custom GPT with an Action)</p>
            <ol className="list-decimal space-y-0.5 pl-4 text-ink-3">
              <li>Avatar menu → Connect AI: create a token and copy it.</li>
              <li>In ChatGPT: Explore GPTs → Create → Configure → Actions → Import from URL, and paste the address below.</li>
              <li>Authentication: API Key, type Bearer, paste the token.</li>
              <li>Paste the prompt above into the GPT&rsquo;s instructions.</li>
            </ol>
            <div className="mt-1 flex gap-2">
              <input readOnly value={`${s.appUrl}/api/ai/openapi.json`} onFocus={(e) => e.currentTarget.select()} className={`${cls} font-mono text-xs`} />
              <button type="button" onClick={() => copy(`${s.appUrl}/api/ai/openapi.json`)} className={btn}>
                Copy
              </button>
            </div>
          </div>
        </div>
      </details>
    </section>
  );
}
