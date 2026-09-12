import { ingestStreamWebhook } from "@/app/engine-actions";

// Cloudflare Stream calls this when a video finishes processing. We don't trust
// the payload — we just take the uid and re-fetch the real state from the API.
export async function POST(req: Request) {
  let uid: string | undefined;
  try {
    const body = await req.json();
    uid = body?.uid || body?.data?.uid;
  } catch {
    /* ignore */
  }
  if (uid) {
    try {
      await ingestStreamWebhook(uid);
    } catch {
      /* ignore */
    }
  }
  return new Response("ok");
}
