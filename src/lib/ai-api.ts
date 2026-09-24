import "server-only";
import { resolveMcpUser } from "@/lib/mcp/auth";
import type { Profile } from "@/lib/types";

/**
 * The plain REST door for AI tools that aren't MCP clients — a ChatGPT custom GPT
 * "Action", Zapier, Make, a script. It uses the same personal tokens as the
 * connector (avatar menu → Connect AI), so a token is one person's seat and can be
 * revoked; nothing here is public.
 */
export async function bearerProfile(req: Request): Promise<Profile | null> {
  const h = req.headers.get("authorization") ?? "";
  const token = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : null;
  return resolveMcpUser(token);
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export const unauthorised = () =>
  json({ error: "Unauthorised. Send Authorization: Bearer <token> with a token from the dashboard's Connect AI page." }, 401);
