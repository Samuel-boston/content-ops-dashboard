import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// DEV-ONLY helper: serves a migration SQL file as plain text with permissive
// CORS so it can be pulled into the Supabase SQL editor during local setup.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }
  const { name } = await params;
  const safe = name.replace(/[^a-z0-9_.-]/gi, "");
  const path = resolve(process.cwd(), "supabase", safe);
  try {
    const sql = await readFile(path, "utf8");
    return new Response(sql, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    return new Response(`not found: ${path}\n${String(e)}`, { status: 404 });
  }
}
