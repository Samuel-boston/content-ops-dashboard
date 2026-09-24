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

/** Signs in and returns the token plus the configured root folder — the base of every archive path. */
export async function driveSession(): Promise<{ token: string; rootId: string }> {
  const s = await getWorkspaceSettings();
  if (!s.drive_folder_id || !s.drive_service_account) throw new NotConfiguredError("Google Drive");
  const token = await getAccessToken(s.drive_service_account as DriveCredentials);
  return { token, rootId: s.drive_folder_id };
}

const FOLDER_MIME = "application/vnd.google-apps.folder";
const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const driveList = (token: string, query: string, fields: string) =>
  fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=${fields}&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives&pageSize=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).then((r) => r.json());

async function createFolder(token: string, parentId: string, name: string, appProperties?: Record<string, string>): Promise<string> {
  const created = await fetch("https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId], ...(appProperties ? { appProperties } : {}) }),
  }).then((r) => r.json());
  if (!created.id) throw new Error(`Could not create folder "${name}": ${JSON.stringify(created)}`);
  return created.id as string;
}

/** Finds a folder by name inside `parentId`, creating it if it isn't there yet. */
export async function ensureFolder(token: string, parentId: string, name: string): Promise<string> {
  const list = await driveList(
    token,
    `name='${esc(name)}' and '${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
    "files(id)"
  );
  return (list.files?.[0]?.id as string | undefined) ?? (await createFolder(token, parentId, name));
}

/**
 * The folder that holds one video's files, tagged with the video's id so it is
 * found again even if the title is edited later. Created in `parentId` if new;
 * moved there if it exists under another parent (e.g. the month changed).
 */
export async function ensureTaggedFolder(token: string, parentId: string, name: string, tag: string): Promise<{ id: string; link: string }> {
  const list = await driveList(
    token,
    `appProperties has { key='videoId' and value='${esc(tag)}' } and mimeType='${FOLDER_MIME}' and trashed=false`,
    "files(id,parents,name)"
  );
  const found = list.files?.[0] as { id: string; parents?: string[]; name: string } | undefined;
  let id: string;
  if (found) {
    id = found.id;
    if (!found.parents?.includes(parentId)) await moveDriveFile(token, id, parentId);
    if (found.name !== name) {
      await fetch(`https://www.googleapis.com/drive/v3/files/${id}?supportsAllDrives=true`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    }
  } else {
    id = await createFolder(token, parentId, name, { videoId: tag });
  }
  return { id, link: `https://drive.google.com/drive/folders/${id}` };
}

/** Moves a file to `toParent` (nothing happens if it is already only there). */
export async function moveDriveFile(token: string, fileId: string, toParent: string): Promise<void> {
  const info = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=parents&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  const parents: string[] = info.parents ?? [];
  if (parents.length === 1 && parents[0] === toParent) return;
  const params = new URLSearchParams({ addParents: toParent, supportsAllDrives: "true" });
  if (parents.length) params.set("removeParents", parents.join(","));
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`Could not move Drive file (${res.status})`);
}

/** Writes a file into `parentId`, replacing any earlier file of the same name so a re-run doesn't pile up copies. */
export async function putBytes(
  token: string,
  parentId: string,
  name: string,
  bytes: Buffer,
  mimeType: string,
  replace = true
): Promise<string> {
  if (replace) {
    const old = await driveList(token, `name='${esc(name)}' and '${parentId}' in parents and trashed=false`, "files(id)");
    for (const f of old.files ?? []) {
      await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?supportsAllDrives=true`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  }
  const res = await uploadBytes(token, bytes, name, mimeType, parentId);
  return res.webViewLink ?? `https://drive.google.com/file/d/${res.id}/view`;
}

/** Upload a file from a URL into a Drive folder (the configured root unless `parentId` is given). Returns webViewLink. */
export async function uploadFromUrl(sourceUrl: string, name: string, parentId?: string, mimeType = "video/mp4"): Promise<string> {
  const { token, rootId } = await driveSession();
  const src = await fetch(sourceUrl);
  if (!src.ok) throw new Error(`Could not fetch source file (${src.status})`);
  const bytes = Buffer.from(await src.arrayBuffer());
  const res = await uploadBytes(token, bytes, name, mimeType, parentId ?? rootId);
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

/** The Drive file id inside a share/view link (".../file/d/<id>/view", "?id=<id>"). */
export function driveFileIdFromLink(link: string): string | null {
  return link.match(/\/d\/([\w-]+)/)?.[1] ?? link.match(/[?&]id=([\w-]+)/)?.[1] ?? null;
}

/**
 * Open a Drive file for reading, as the dashboard's own Drive login. The
 * response body is the file itself, so it can be streamed on to someone who
 * has no Drive access of their own.
 */
export async function openDriveFile(fileId: string): Promise<Response> {
  const s = await getWorkspaceSettings();
  if (!s.drive_service_account) throw new NotConfiguredError("Google Drive");
  const token = await getAccessToken(s.drive_service_account as DriveCredentials);
  return fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
}
