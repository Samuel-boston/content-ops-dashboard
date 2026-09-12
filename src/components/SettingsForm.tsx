"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateWorkspaceSettingsAction } from "@/app/settings-actions";
import type { IntegrationStatus } from "@/lib/types";

type Redacted = Record<string, unknown>;

function Field({
  name,
  label,
  hint,
  defaultValue,
  type = "text",
  textarea,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue?: string | null;
  type?: string;
  textarea?: boolean;
}) {
  const cls =
    "w-full rounded-lg bg-raised border border-line-strong px-3 py-2 text-sm outline-none focus:border-accent";
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-ink-2">{label}</label>
      {textarea ? (
        <textarea name={name} rows={3} defaultValue={defaultValue ?? ""} className={`${cls} resize-none font-mono text-xs`} />
      ) : (
        <input name={name} type={type} defaultValue={defaultValue ?? ""} className={cls} />
      )}
      {hint ? <p className="mt-0.5 text-[11px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

function StatusDot({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${on ? "bg-emerald-400" : "bg-line-strong"}`}
    />
  );
}

export function SettingsForm({
  settings,
  status,
}: {
  settings: Redacted;
  status: IntegrationStatus;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const s = settings as Record<string, string | null>;

  return (
    <form
      action={async (fd) => {
        const r = await updateWorkspaceSettingsAction(fd);
        setMsg(r?.error ?? "Saved.");
        if (!r?.error) router.refresh();
      }}
      className="space-y-6"
    >
      <section className="rounded-xl border border-line bg-app p-4 space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <StatusDot on={status.stream} /> Cloudflare Stream <span className="text-ink-3">— active-review video</span>
        </h2>
        <Field name="cf_account_id" label="Account ID" defaultValue={s.cf_account_id} />
        <Field
          name="cf_stream_token"
          label="API token (Stream: Read + Edit)"
          defaultValue={s.cf_stream_token}
          hint="Leave the masked value to keep the current token."
        />
        <Field
          name="cf_stream_customer_code"
          label="Customer subdomain code"
          defaultValue={s.cf_stream_customer_code}
          hint="The customer-xxxx in your playback URLs."
        />
      </section>

      <section className="rounded-xl border border-line bg-app p-4 space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <StatusDot on={status.drive} /> Google Drive <span className="text-ink-3">— raw footage + posted archive</span>
        </h2>
        <Field name="drive_folder_id" label="Target folder ID" defaultValue={s.drive_folder_id} />
        <Field
          name="drive_service_account"
          label="Service-account JSON"
          textarea
          defaultValue={s.drive_service_account}
          hint="Paste the full JSON key. Share the folder with the service account's email."
        />
      </section>

      <section className="rounded-xl border border-line bg-app p-4 space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <StatusDot on={status.instagram} /> Instagram Graph API <span className="text-ink-3">— analytics + publishing</span>
        </h2>
        <Field name="ig_user_id" label="IG Business/Creator user ID" defaultValue={s.ig_user_id} />
        <Field name="ig_access_token" label="Long-lived access token" defaultValue={s.ig_access_token} />
        <Field name="ig_token_expires_at" label="Token expires (optional)" type="date" defaultValue={s.ig_token_expires_at} />
      </section>

      <section className="rounded-xl border border-line bg-app p-4 space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <StatusDot on={status.ai} /> AI scripting{" "}
          <span className="text-ink-3">— hooks, drafts, captions, ideas, tags, summaries</span>
        </h2>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ink-2">Engine</label>
          <div className="flex flex-wrap gap-4">
            {[
              { value: "groq", label: "Groq", hint: "free tier" },
              { value: "anthropic", label: "Claude (Anthropic)", hint: "paid, real Claude" },
              { value: "openai", label: "OpenAI", hint: "paid" },
            ].map((opt) => (
              <label key={opt.value} className="flex items-center gap-1.5 text-sm text-ink-2">
                <input
                  type="radio"
                  name="ai_provider"
                  value={opt.value}
                  defaultChecked={(s.ai_provider || "groq") === opt.value}
                  className="accent-accent"
                />
                {opt.label} <span className="text-[11px] text-ink-3">({opt.hint})</span>
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-ink-3">
            Whichever is picked here runs every AI-scripting feature. The others&rsquo; keys can stay
            filled in unused, so switching later is instant — no other setting changes.
          </p>
        </div>
        <Field
          name="groq_api_key"
          label="Groq API key"
          defaultValue={s.groq_api_key}
          hint="Free tier, no card required — console.groq.com."
        />
        <Field
          name="anthropic_api_key"
          label="Anthropic API key (Claude)"
          defaultValue={s.anthropic_api_key}
          hint="console.anthropic.com — real per-use cost, no free tier."
        />
        <p className="text-[11px] text-ink-3">
          OpenAI as an engine reuses the OpenAI key below (Telegram automations) — the same key
          already used for Whisper transcription.
        </p>
      </section>

      <section className="rounded-xl border border-line bg-app p-4 space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <StatusDot on={status.telegram} /> Telegram automations
        </h2>
        <Field name="telegram_bot_token" label="Bot token" defaultValue={s.telegram_bot_token} />
        <Field
          name="telegram_chat_ids"
          label="Authorised chat IDs"
          defaultValue={(s.telegram_chat_ids as unknown as number[])?.join(", ")}
          hint="Comma/space separated. The bot only acts on these chats."
        />
        <Field
          name="telegram_user_ids"
          label="Authorised user IDs (optional)"
          defaultValue={(s.telegram_user_ids as unknown as number[])?.join(", ")}
          hint="Blank = any user in the authorised chats."
        />
        <Field
          name="openai_api_key"
          label="OpenAI API key (Whisper transcription — spoken briefs only)"
          defaultValue={s.openai_api_key}
        />
        <p className="text-[11px] text-ink-3">
          Webhook URL: <code>/api/telegram/webhook</code> · Cron URL: <code>/api/cron?key=$CRON_SECRET</code>
        </p>
      </section>

      <div className="flex items-center gap-3">
        <button className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hi">
          Save settings
        </button>
        {msg ? <span className="text-sm text-ink-2">{msg}</span> : null}
      </div>
    </form>
  );
}
