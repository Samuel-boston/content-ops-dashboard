import { requireRole } from "@/lib/auth";
import { storageUsage } from "@/app/settings-extra-actions";
import { StorageUsage } from "@/components/StorageUsage";
import { SetupGuide } from "@/components/SetupGuide";
import {
  brandingFor,
  getWorkspaceSettings,
  integrationStatus,
  publerAccounts,
  redactSettings,
} from "@/lib/workspace";
import { SettingsForm } from "@/components/SettingsForm";
import { BrandingForm } from "@/components/BrandingForm";
import { PublerConnect } from "@/components/PublerConnect";
import { SlackConnect } from "@/components/SlackConnect";

export default async function SettingsPage() {
  await requireRole("owner");
  const [settings, usage, branding] = await Promise.all([
    getWorkspaceSettings(),
    storageUsage(),
    brandingFor(),
  ]);
  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Workspace settings</h1>
        <p className="text-sm text-ink-2">
          Integration credentials. Stored in the database, Owner-only. Moving to the client&rsquo;s own
          accounts later is an edit here — not a redeploy.
        </p>
      </div>
      <SetupGuide />
      <BrandingForm
        brandName={settings.brand_name}
        clientName={settings.client_name}
        logoUrl={branding.logoUrl}
      />
      <PublerConnect
        connected={integrationStatus(settings).publer}
        hasKey={Boolean(settings.publer_api_key)}
        accounts={Object.fromEntries(Object.entries(publerAccounts(settings)).map(([n, a]) => [n, a.name]))}
        trialMode={settings.publer_trial_mode ?? "MANUAL"}
      />
      <SlackConnect
        connected={integrationStatus(settings).slack}
        team={settings.slack_team_name}
        channelId={settings.slack_channel_id}
        channelName={settings.slack_channel_name}
        announce={settings.slack_announce}
        appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
      />
      <SettingsForm
        settings={redactSettings(settings)}
        status={integrationStatus(settings)}
      />
      <StorageUsage usage={usage} />
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Backups</h2>
        <div className="rounded-xl border border-line bg-card p-4 text-xs leading-relaxed text-ink-2">
          Backups are handled by Supabase, not by this dashboard. On the Pro plan every database is backed up daily and
          kept for 7 days, and a backup is restored in a few clicks from Supabase → Database → Backups. Point-in-time
          recovery is an optional Supabase add-on. Uploaded files (music, references, comment attachments, carousel
          images) live in Supabase Storage and are not part of those database backups; finished videos and raw footage
          are archived to Google Drive.
        </div>
      </section>
    </div>
  );
}
