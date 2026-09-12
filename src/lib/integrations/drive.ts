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

async function getAccessToken(sa: ServiceAccount): Promise<string> {
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

/** Upload a file from a URL into the configured Drive folder. Returns webViewLink. */
export async function uploadFromUrl(sourceUrl: string, name: string): Promise<string> {
  const s = await getWorkspaceSettings();
  if (!s.drive_folder_id || !s.drive_service_account) throw new NotConfiguredError("Google Drive");
  const sa = s.drive_service_account as ServiceAccount;
  const token = await getAccessToken(sa);

  const src = await fetch(sourceUrl);
  if (!src.ok) throw new Error(`Could not fetch source file (${src.status})`);
  const bytes = Buffer.from(await src.arrayBuffer());

  const boundary = "cod" + Math.random().toString(16).slice(2);
  const metadata = JSON.stringify({ name, parents: [s.drive_folder_id] });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
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
  return res.webViewLink ?? `https://drive.google.com/file/d/${res.id}/view`;
}
