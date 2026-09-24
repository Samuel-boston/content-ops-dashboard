import { supabaseAdmin } from "@/lib/supabase/admin";
import { readPhoneToken } from "@/lib/phone-link";
import { getDownloadUrl } from "@/lib/integrations/stream";

/**
 * The page a phone lands on after scanning a variant's QR code: the file to
 * save and the caption to paste. Public by design — the signed, expiring
 * token in the URL is the credential (see lib/phone-link.ts).
 */

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function page(body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Save to phone</title><style>
body{margin:0;background:#0b0b0e;color:#f2f2f5;font:16px/1.5 -apple-system,system-ui,sans-serif;padding:20px}
h1{font-size:18px;margin:0 0 4px}p{color:#a0a0ab;margin:4px 0 16px}
a.btn,button{display:block;width:100%;box-sizing:border-box;text-align:center;background:#7c5cff;color:#fff;border:0;border-radius:12px;padding:14px;font-size:16px;font-weight:600;text-decoration:none;margin:10px 0}
button.alt{background:#23232b}.cap{white-space:pre-wrap;background:#16161b;border-radius:12px;padding:12px;margin:8px 0;color:#f2f2f5}
img{width:100%;border-radius:10px;margin:6px 0}
</style></head><body>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const trialId = readPhoneToken(token);
  if (!trialId) {
    return page("<h1>This link has expired</h1><p>Go back to the Posting desk and scan a fresh QR code.</p>", 410);
  }

  const db = supabaseAdmin();
  const { data: t } = await db
    .from("trial_posts")
    .select("video_id, cut_id, label, caption, video:videos (title)")
    .eq("id", trialId)
    .maybeSingle();
  if (!t) return page("<h1>Not found</h1>", 404);
  const title = (t.video as unknown as { title: string } | null)?.title ?? "Video";
  const caption = (t.caption as string | null)?.trim();

  let files = "";
  if (t.cut_id) {
    const { data: top } = await db
      .from("cut_versions")
      .select("stream_uid, drive_file_url")
      .eq("cut_id", t.cut_id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    let url: string | null = top?.drive_file_url ?? null;
    if (!url && top?.stream_uid) {
      try {
        url = await getDownloadUrl(top.stream_uid);
      } catch {
        url = null;
      }
    }
    files = url
      ? `<a class="btn" href="${esc(url)}" download>Download the video</a>`
      : "<p>No downloadable file for this variant yet — ask the team.</p>";
  } else {
    const { data: slides } = await db
      .from("carousel_images")
      .select("storage_path")
      .eq("video_id", t.video_id)
      .not("storage_path", "is", null)
      .order("position");
    const urls: string[] = [];
    for (const s of slides ?? []) {
      const { data: u } = await db.storage.from("carousels").createSignedUrl(s.storage_path as string, 3600);
      if (u?.signedUrl) urls.push(u.signedUrl);
    }
    files = urls.length
      ? "<p>Press and hold an image to save it, in this order:</p>" +
        urls.map((u, i) => `<img src="${esc(u)}" alt="Slide ${i + 1}">`).join("")
      : "<p>No slide images yet.</p>";
  }

  const captionBlock = caption
    ? `<p>Caption</p><div class="cap" id="cap">${esc(caption)}</div>
<button class="alt" onclick="navigator.clipboard.writeText(document.getElementById('cap').innerText).then(()=>this.textContent='Copied ✓')">Copy the caption</button>`
    : "";

  return page(`<h1>${esc(title)}</h1><p>${esc(t.label as string)}</p>${files}${captionBlock}`);
}
