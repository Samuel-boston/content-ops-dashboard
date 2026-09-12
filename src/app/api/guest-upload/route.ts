import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Phone-upload endpoint. No session — the token is the credential, and it's
 * re-checked on both calls rather than trusted from the first one.
 *
 * POST  → mint a one-shot signed upload URL for a file
 * PUT   → register the finished upload against the video
 */

async function resolveUploadToken(token: unknown): Promise<string | null> {
  if (typeof token !== "string" || token.length < 20) return null;
  const db = supabaseAdmin();
  const { data } = await db
    .from("guest_links")
    .select("video_id, revoked, expires_at, purpose")
    .eq("token", token)
    .maybeSingle();
  if (!data || data.revoked || data.purpose !== "upload") return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;
  return data.video_id as string;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const videoId = await resolveUploadToken(body?.token);
  if (!videoId) {
    return NextResponse.json({ error: "This upload link is no longer active." }, { status: 403 });
  }

  const filename = String(body?.filename ?? "clip.mp4");
  const ext = filename.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  const path = `${videoId}/${crypto.randomUUID()}.${ext}`;

  const db = supabaseAdmin();
  const { data, error } = await db.storage.from("footage").createSignedUploadUrl(path);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ path, signedUrl: data.signedUrl });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  const videoId = await resolveUploadToken(body?.token);
  if (!videoId) {
    return NextResponse.json({ error: "This upload link is no longer active." }, { status: 403 });
  }
  if (typeof body?.path !== "string" || !body.path.startsWith(`${videoId}/`)) {
    return NextResponse.json({ error: "Bad path." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { error } = await db.from("video_assets").insert({
    video_id: videoId,
    kind: "raw",
    label: String(body.filename ?? "Phone upload"),
    storage_path: body.path,
    size_bytes: Number(body.size) || null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
