import { bearerProfile, json, unauthorised } from "@/lib/ai-api";
import * as tools from "@/lib/mcp/tools";

export const runtime = "nodejs";

/** GET: the playbook docs (the client's offer, ideal client and SOPs). With ?id= returns one in full. */
export async function GET(req: Request) {
  const profile = await bearerProfile(req);
  if (!profile) return unauthorised();
  const id = new URL(req.url).searchParams.get("id");
  return json(id ? await tools.getPlaybookDoc(profile, { id }) : await tools.listPlaybookDocs(profile));
}
