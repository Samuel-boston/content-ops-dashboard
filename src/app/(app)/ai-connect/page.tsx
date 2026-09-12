import { requireUser } from "@/lib/auth";
import { listApiTokensAction } from "@/app/ai-connect-actions";
import { ApiTokenManager } from "@/components/ApiTokenManager";

const MCP_URL = `${process.env.NEXT_PUBLIC_APP_URL || "https://adam-content-ops.vercel.app"}/api/mcp`;

export default async function AiConnectPage() {
  await requireUser();
  const tokens = await listApiTokensAction();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Connect your AI assistant</h1>
        <p className="text-sm text-ink-2">
          Use Claude, ChatGPT, or whatever you already pay for to actually run this dashboard — pull up
          videos, drop in ideas, write scripts, add hooks, message an editor — all from inside that chat.
          No extra AI cost: this just lets your existing assistant read and write here.
        </p>
      </div>

      <section className="rounded-xl border border-line bg-app p-4 space-y-3">
        <h2 className="text-sm font-semibold">1. Generate a token</h2>
        <p className="text-xs text-ink-2">
          One token per assistant. Anything done through it happens as you — same permissions you have in
          the dashboard.
        </p>
        <ApiTokenManager tokens={tokens} />
      </section>

      <section className="rounded-xl border border-line bg-app p-4 space-y-3">
        <h2 className="text-sm font-semibold">2. Connect it</h2>
        <div className="space-y-1">
          <p className="text-xs font-medium text-ink-1">Server URL</p>
          <code className="block rounded-md bg-raised px-2 py-1.5 text-xs">{MCP_URL}</code>
        </div>

        <div className="space-y-1.5 border-t border-line pt-3">
          <p className="text-xs font-medium text-ink-1">Claude (claude.ai or the Claude desktop app)</p>
          <ol className="list-decimal space-y-0.5 pl-4 text-xs text-ink-2">
            <li>Settings → Customize → Connectors → Add custom connector</li>
            <li>Name it anything, paste the Server URL above, Continue</li>
            <li>Under Authentication, pick <strong>No sign-in</strong> (Claude defaults to &ldquo;Sign in now&rdquo; — switch it)</li>
            <li>Under Request headers, Add header → name <code>authorization</code>, value <code>Bearer </code> followed by the token from step 1 (no quotes)</li>
            <li>Add, then Connect</li>
          </ol>
        </div>

        <div className="space-y-1.5 border-t border-line pt-3">
          <p className="text-xs font-medium text-ink-1">ChatGPT</p>
          <ol className="list-decimal space-y-0.5 pl-4 text-xs text-ink-2">
            <li>Settings → Connectors → Advanced → enable Developer mode (once)</li>
            <li>Create connector, paste the Server URL above</li>
            <li>Auth type: Bearer token — paste the token from step 1</li>
          </ol>
        </div>

        <p className="border-t border-line pt-3 text-[11px] text-ink-3">
          Once it&rsquo;s connected, just talk to it normally — &ldquo;give me every video ready to
          script,&rdquo; &ldquo;add this as a new idea,&rdquo; &ldquo;save this script to that video,&rdquo;
          &ldquo;message the editor on this one and ask for an update.&rdquo; It only ever acts within
          your own role&rsquo;s permissions.
        </p>
      </section>
    </div>
  );
}
