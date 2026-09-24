import { requireRole } from "@/lib/auth";
import { lastBackup, storageUsage } from "@/app/settings-extra-actions";
import { StorageUsage } from "@/components/StorageUsage";
import { BackupStatus } from "@/components/BackupStatus";
import {
  brandingFor,
  getWorkspaceSettings,
  integrationStatus,
  redactSettings,
} from "@/lib/workspace";
import { SettingsForm } from "@/components/SettingsForm";
import { BrandingForm } from "@/components/BrandingForm";

export default async function SettingsPage() {
  await requireRole("owner");
  const [settings, usage, branding, backup] = await Promise.all([
    getWorkspaceSettings(),
    storageUsage(),
    brandingFor(),
    lastBackup(),
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
      <BrandingForm
        brandName={settings.brand_name}
        clientName={settings.client_name}
        logoUrl={branding.logoUrl}
      />
      <SettingsForm
        settings={redactSettings(settings)}
        status={integrationStatus(settings)}
      />
      <StorageUsage usage={usage} />
      <BackupStatus last={backup} driveConfigured={integrationStatus(settings).drive} />
    </div>
  );
}
