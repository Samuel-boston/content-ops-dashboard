import "server-only";
import { getWorkspaceSettings } from "@/lib/workspace";
import { NotConfiguredError } from "@/lib/integrations/stream";

// Minimal Google Drive integration using a service account. Used to move a
// video's file(s) out of Cloudflare Stream and into Drive the moment it's
// Posted — keeping the Stream working set small and flat forever.

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/**
 * Google's standard "authorized user" credentials: a person's own account
 * acting through an OAuth client. Files are created as (and count against the
 * storage of) that person, so it works with an ordinary Gmail "My Drive" —
 * which a service account can't. The workspace's Drive field accepts either
 * shape; this one is the easy way to connect a personal account for a trial.
 */
interface AuthorizedUser {
  type: "authorized_user";
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

type DriveCredentials = ServiceAccount | AuthorizedUser;

async function getAccessToken(creds: DriveCredentials): Promise<string> {
  if ((creds as AuthorizedUser).type === "authorized_user") {
    const u = creds as AuthorizedUser;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: u.client_id,
        client_secret: u.client_secret,
        refresh_token: u.refresh_token,
        grant_type: "refresh_token",
      }),
    }).then((r) => r.json());
    if (!res.access_token) throw new Error(`Google refused the saved login: ${JSON.stringify(res)}`);
    return res.access_token as string;
  }
  const sa = creds as ServiceAccount;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: sa.token_uri || "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64(header)}.${b64(claim)}`;

  const { createSign } = await import("node:crypto");
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = signer.sign(sa.private_key).toString("base64url");
  const jwt = `${unsigned}.${signature}`;

  const res = await fetch(claim.aud, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  }).then((r) => r.json());
  if (!res.access_token) throw new Error(`Drive auth failed: ${JSON.stringify(res)}`);
  return res.access_token;
}

/** Multipart-uploads raw bytes into one Drive folder. Shared by every upload helper below. */
async function uploadBytes(
  token: string,
  bytes: Buffer,
  name: string,
  mimeType: string,
  parentId: string
): Promise<{ id: string; webViewLink?: string }> {
  const boundary = "cod" + Math.random().toString(16).slice(2);
  const metadata = JSON.stringify({ name, parents: [parentId] });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  ).then((r) => r.json());
  if (!res.id) throw new Error(`Drive upload failed: ${JSON.stringify(res)}`);
  return res;
}

/** Upload a file from a URL into the configured Drive folder. Returns webViewLink. */
export async function uploadFromUrl(sourceUrl: string, name: string): Promise<string> {
  const s = await getWorkspaceSettings();
  if (!s.drive_folder_id || !s.drive_service_account) throw new NotConfiguredError("Google Drive");
  const sa = s.drive_service_account as DriveCredentials;
  const token = await getAccessToken(sa);

  const src = await fetch(sourceUrl);
  if (!src.ok) throw new Error(`Could not fetch source file (${src.status})`);
  const bytes = Buffer.from(await src.arrayBuffer());

  const res = await uploadBytes(token, bytes, name, "video/mp4", s.drive_folder_id);
  return res.webViewLink ?? `https://drive.google.com/file/d/${res.id}/view`;
}

/** Finds (or creates) a "Backups" subfolder inside the configured Drive folder — kept separate from footage/posted videos so it doesn't clutter what the team browses day to day. */
async function ensureBackupsFolder(token: string, parentId: string): Promise<string> {
  const q = encodeURIComponent(
    `name='Backups' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const list = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  if (list.files?.[0]?.id) return list.files[0].id as string;

  const created = await fetch("https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Backups",
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  }).then((r) => r.json());
  if (!created.id) throw new Error(`Could not create Backups folder: ${JSON.stringify(created)}`);
  return created.id as string;
}

/**
 * Drops a JSON backup into a "Backups" subfolder of the configured Drive
 * folder, then trims anything older than `keepDays` — a daily export is
 * cheap, but nobody wants it growing forever unattended.
 */
export async function uploadBackupJson(name: string, json: string, keepDays = 30): Promise<string> {
  const s = await getWorkspaceSettings();
  if (!s.drive_folder_id || !s.drive_service_account) throw new NotConfiguredError("Google Drive");
  const sa = s.drive_service_account as DriveCredentials;
  const token = await getAccessToken(sa);
  const folderId = await ensureBackupsFolder(token, s.drive_folder_id);

  const res = await uploadBytes(token, Buffer.from(json, "utf8"), name, "application/json", folderId);

  const cutoff = new Date(Date.now() - keepDays * 864e5).toISOString();
  const q = encodeURIComponent(
    `'${folderId}' in parents and mimeType='application/json' and trashed=false and createdTime < '${cutoff}'`
  );
  const old = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  for (const f of old.files ?? []) {
    await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?supportsAllDrives=true`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }

  return res.webViewLink ?? `https://drive.google.com/file/d/${res.id}/view`;
}

/**
 * A round trip that proves the saved Drive login works: sign in, write a tiny
 * file into the configured folder, read back its link, delete it. Throws a
 * readable error if any step fails.
 */
export async function testDriveConnection(): Promise<string> {
  const s = await getWorkspaceSettings();
  if (!s.drive_folder_id || !s.drive_service_account) throw new NotConfiguredError("Google Drive");
  const token = await getAccessToken(s.drive_service_account as DriveCredentials);
  const file = await uploadBytes(
    token,
    Buffer.from(`Content Ops connection test — ${new Date().toISOString()}`),
    "content-ops-connection-test.txt",
    "text/plain",
    s.drive_folder_id
  );
  await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?supportsAllDrives=true`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  return "Connected — a test file was written to the folder and removed again.";
}
