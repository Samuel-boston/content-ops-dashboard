"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { SETUP_GUIDES, buildPrompt, type SetupMode } from "@/lib/setup-guides";

const TABS: { id: SetupMode; label: string }[] = [
  { id: "claude", label: "Claude Chrome extension" },
  { id: "chatgpt", label: "ChatGPT computer control" },
  { id: "manual", label: "Manually" },
];

const PREP: Record<Exclude<SetupMode, "manual">, string[]> = {
  claude: [
    "Install the Claude extension: search “Claude” in the Chrome Web Store (Claude in Chrome), add it, and sign in with your Claude account.",
    "Pin it to the toolbar and open it. Make sure it says it is connected to this browser, and allow it to act on the sites it asks about.",
    "Stay signed in to this dashboard in this Chrome window, then copy the prompt below into the Claude extension (or claude.ai with the extension connected).",
  ],
  chatgpt: [
    "Use ChatGPT's desktop app on your Mac (or ChatGPT in the browser) with agent / computer control turned on. This needs a paid ChatGPT plan that includes it.",
    "When your Mac asks, allow ChatGPT to control the browser and see the screen. Open Chrome, stay signed in to this dashboard, and keep that window visible.",
    "Copy the prompt below into ChatGPT and let it run. It will stop and ask you at logins, verification codes and payments.",
  ],
};

/**
 * Setup guides for every integration, three ways: hand it to Claude (with its Chrome extension),
 * hand it to ChatGPT with computer control, or follow the steps by hand (the default).
 * The steps and the prompts come from one source (lib/setup-guides.ts) so they always agree.
 */
export function SetupGuide() {
  const toast = useToast();
  const [mode, setMode] = useState<SetupMode>("manual");
  const [open, setOpen] = useState<string | null>(null);
  const app = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <section className="space-y-3 rounded-xl border border-line bg-app p-4">
      <div>
        <h2 className="text-sm font-semibold">Set up your integrations</h2>
        <p className="mt-0.5 text-xs text-ink-3">
          Pick how you want to do it. Every integration below has the same steps whichever you choose — a person can follow them, or
          Claude or ChatGPT can do them for you in the browser.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-line bg-raised p-0.5" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={mode === t.id}
            onClick={() => setMode(t.id)}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              mode === t.id ? "bg-accent text-white" : "text-ink-2 hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {mode !== "manual" ? (
        <div className="rounded-lg border border-accent/30 bg-accent-ghost/40 p-3">
          <p className="text-xs font-medium text-ink">Before you start</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-xs text-ink-2">
            {PREP[mode].map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="space-y-1.5">
        {SETUP_GUIDES.map((g) => {
          const isOpen = open === g.id;
          return (
            <div key={g.id} className="rounded-lg border border-line bg-card">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : g.id)}
                aria-expanded={isOpen}
                className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
              >
                <span className="mt-0.5 text-ink-3">{isOpen ? "▾" : "▸"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{g.title}</span>
                  <span className="block text-[11px] leading-snug text-ink-3">{g.blurb}</span>
                </span>
              </button>
              {isOpen ? (
                <div className="space-y-3 border-t border-line px-3 py-3">
                  {mode === "manual" ? (
                    <>
                      <ol className="list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-ink-2">
                        {g.steps.map((s) => (
                          <li key={s}>{s.replaceAll("{app}", app)}</li>
                        ))}
                      </ol>
                      <div className="rounded-md bg-raised px-2.5 py-2 text-xs text-ink-2">
                        <p className="font-medium text-ink">Then paste into Settings:</p>
                        <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                          {g.fields.map((f) => (
                            <li key={f}>{f}</li>
                          ))}
                        </ul>
                        <p className="mt-1.5">{g.finish}</p>
                      </div>
                      <p className="text-[11px] text-ink-3">
                        Would rather not do this by hand? Choose the <b>Claude Chrome extension</b> or <b>ChatGPT computer control</b> tab above
                        and let it do all of this for you.
                      </p>
                    </>
                  ) : (
                    <>
                      <textarea
                        readOnly
                        value={buildPrompt(g, mode, app)}
                        rows={12}
                        onFocus={(e) => e.currentTarget.select()}
                        className="w-full resize-y rounded-md border border-line bg-raised px-2.5 py-2 font-mono text-[11px] leading-relaxed text-ink-2 focus:outline-none"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            navigator.clipboard
                              .writeText(buildPrompt(g, mode, app))
                              .then(() => toast.success("Prompt copied — paste it into " + (mode === "claude" ? "Claude." : "ChatGPT.")))
                              .catch(() => toast.error("Couldn't copy — select the text and copy it by hand."))
                          }
                          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hi"
                        >
                          Copy the prompt
                        </button>
                        <span className="text-[11px] text-ink-3">
                          It contains no passwords or keys. It will stop and ask you at logins, codes and payments.
                        </span>
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
