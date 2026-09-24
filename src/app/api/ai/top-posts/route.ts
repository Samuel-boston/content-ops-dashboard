import { bearerProfile, json, unauthorised } from "@/lib/ai-api";
import * as tools from "@/lib/mcp/tools";

export const runtime = "nodejs";

/** GET: the Top posts list, best first. Query: ?query=&source=own|inspiration&limit=. */
export async function GET(req: Request) {
  const profile = await bearerProfile(req);
  if (!profile) return unauthorised();
  const u = new URL(req.url);
  const parsed = tools.listTopPostsSchema.safeParse({
    query: u.searchParams.get("query") ?? undefined,
    source: u.searchParams.get("source") ?? undefined,
    limit: u.searchParams.get("limit") ? Number(u.searchParams.get("limit")) : undefined,
  });
  if (!parsed.success) return json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, 400);
  return json(await tools.listTopPosts(profile, parsed.data));
}

/** POST: add posts. Body: {"posts": [{"topic", "hook", "views", "link", "platform", "creator", ...}]}. Owner or admin only. */
export async function POST(req: Request) {
  const profile = await bearerProfile(req);
  if (!profile) return unauthorised();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send a JSON body." }, 400);
  }
  const parsed = tools.addTopPostsSchema.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
  const res = await tools.addTopPosts(profile, parsed.data);
  return json(res, "error" in res ? 403 : 200);
}
