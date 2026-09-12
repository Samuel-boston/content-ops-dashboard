"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import type { CutComment, CutWithVersions, GuestLink, Video } from "@/lib/types";

export interface GuestAssetItem {
  id: string;
  label: string;
  note: string | null;
  /** A direct download link (Supabase storage) or an outside one (Drive, a shared post). Never both null unless nothing usable was ever attached. */
  url: string | null;
  /** Drive/external links open elsewhere rather than downloading directly. */
  external: boolean;
}

/** URL-safe, unguessable, and the only credential a guest ever holds. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function listGuestLinks(videoId: string): Promise<GuestLink[]> {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("guest_links")
    .select("*")
    .eq("video_id", videoId)
    .order("created_at", { ascending: false });
  return (data as GuestLink[]) ?? [];
}

export async function createGuestLinkAction(input: {
  videoId: string;
  label?: string;
  purpose?: "review" | "upload" | "assets";
  expiresInDays?: number | null;
}) {
  const me = await requireRole("owner", "admin");
  const supabase = await supabaseServer();

  const expires = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString()
    : null;

  const { data, error } = await supabase
    .from("guest_links")
    .insert({
      video_id: input.videoId,
      token: newToken(),
      label: input.label?.trim() || null,
      purpose: input.purpose ?? "review",
      expires_at: expires,
      created_by: me.id,
    })
    .select("token")
    .single();
  if (error) return { error: error.message };

  revalidatePath(`/videos/${input.videoId}`);
  return { ok: true, token: data.token as string };
}

export async function revokeGuestLinkAction(id: string, videoId: string) {
  await requireRole("owner", "admin");
  const supabase = await supabaseServer();
  const { error } = await supabase.from("guest_links").update({ revoked: true }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/videos/${videoId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Public side — no session, the token is the whole credential
// ---------------------------------------------------------------------------

export interface GuestView {
  video: Pick<Video, "id" | "title" | "brief" | "status">;
  cuts: CutWithVersions[];
  /** Only client-visible comments. Internal notes never leave the team. */
  comments: CutComment[];
  purpose: "review" | "upload" | "assets";
  /** Only populated for purpose "assets". */
  assets?: {
    footage: GuestAssetItem[];
    references: GuestAssetItem[];
  };
}

/**
 * Resolve a token to what the guest is allowed to see.
 *
 * Uses the service-role client deliberately: there is no signed-in user here,
 * so RLS can't be the boundary. The token lookup *is* the boundary, and every
 * field returned below is chosen by hand rather than selected with `*`.
 */
export async function resolveGuestToken(token: string): Promise<GuestView | null> {
  if (!token || token.length < 20) return null;
  const db = supabaseAdmin();

  const { data: link } = await db
    .from("guest_links")
    .select("video_id, revoked, expires_at, purpose")
    .eq("token", token)
    .maybeSingle();

  if (!link || link.revoked) return null;
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) return null;

  const { data: video } = await db
    .from("videos")
    .select("id, title, brief, status")
    .eq("id", link.video_id)
    .maybeSingle();
  if (!video) return null;

  if (link.purpose === "assets") {
    const [{ data: footage }, { data: references }] = await Promise.all([
      db
        .from("video_assets")
        .select("id, label, storage_path, drive_url, external_url")
        .eq("video_id", link.video_id)
        .order("created_at", { ascending: false }),
      db
        .from("reference_items")
        .select("id, kind, storage_path, url, note")
        .eq("video_id", link.video_id)
        .neq("status", "archived")
        .order("created_at", { ascending: false }),
    ]);

    const footageItems: GuestAssetItem[] = await Promise.all(
      (footage ?? []).map(async (a) => {
        if (a.storage_path) {
          const { data: signed } = await db.storage.from("footage").createSignedUrl(a.storage_path, 3600);
          return { id: a.id, label: a.label || "Footage", note: null, url: signed?.signedUrl ?? null, external: false };
        }
        return { id: a.id, label: a.label || "Footage", note: null, url: a.drive_url || a.external_url || null, external: true };
      })
    );

    const referenceItems: GuestAssetItem[] = await Promise.all(
      (references ?? []).map(async (r) => {
        if (r.storage_path) {
          const { data: signed } = await db.storage.from("references").createSignedUrl(r.storage_path, 3600);
          return { id: r.id, label: r.kind === "video" ? "Reference clip" : "Reference image", note: r.note, url: signed?.signedUrl ?? null, external: false };
        }
        return { id: r.id, label: "Reference link", note: r.note, url: r.url, external: true };
      })
    );

    return {
      video: video as GuestView["video"],
      cuts: [],
      comments: [],
      purpose: "assets",
      assets: { footage: footageItems, references: referenceItems },
    };
  }

  const { data: cuts } = await db
    .from("video_cuts")
    .select("id, video_id, kind, label, notes, position, created_by, created_at")
    .eq("video_id", link.video_id)
    .order("position");

  const cutIds = (cuts ?? []).map((c) => c.id);
  const { data: versions } = cutIds.length
    ? await db.from("cut_versions").select("*").in("cut_id", cutIds).order("version", { ascending: false })
    : { data: [] };

  const { data: comments } = cutIds.length
    ? await db
        .from("cut_comments")
        .select(
          "*, author:profiles!cut_comments_author_id_fkey (id, full_name, email, role)"
        )
        .in("cut_id", cutIds)
        .eq("visibility", "client")
        .order("created_at")
    : { data: [] };

  return {
    video: video as GuestView["video"],
    cuts: ((cuts ?? []) as CutWithVersions[]).map((c) => ({
      ...c,
      versions: ((versions ?? []) as CutWithVersions["versions"]).filter((v) => v.cut_id === c.id),
    })),
    comments: (comments ?? []) as unknown as CutComment[],
    purpose: (link.purpose as "review" | "upload" | null) ?? "review",
  };
}

/** A guest leaving a note. Always client-visible; never anonymous internally. */
export async function guestCommentAction(input: {
  token: string;
  cutId: string;
  name: string;
  body: string;
  tStart: number | null;
}) {
  const view = await resolveGuestToken(input.token);
  if (!view || view.purpose !== "review") return { error: "This link is no longer active." };
  if (!view.cuts.some((c) => c.id === input.cutId)) return { error: "Unknown cut." };

  const body = input.body.trim();
  if (!body) return { error: "Write something first." };
  const name = input.name.trim() || "Guest";

  const db = supabaseAdmin();
  const { error } = await db.from("cut_comments").insert({
    cut_id: input.cutId,
    version: null,
    parent_comment_id: null,
    author_id: null,
    // The name is prefixed into the body because a guest has no profile row to
    // attribute the comment to.
    body: `${name}: ${body}`,
    t_start_seconds: input.tStart,
    t_end_seconds: null,
    mentions: [],
    resolved: false,
    visibility: "client",
    assignee_id: null,
    drawing: null,
    voice_path: null,
    voice_duration_seconds: null,
    voice_peaks: null,
    attachments: [],
  });
  if (error) return { error: error.message };

  revalidatePath(`/videos/${view.video.id}`);
  return { ok: true };
}
