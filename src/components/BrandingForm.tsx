"use client";

import { useRef, useState } from "react";
import { useTrackedTransition } from "@/components/ui/Pending";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { saveBrandingAction } from "@/app/settings-actions";
import { IconTrash } from "@/components/ui/icons";

const MAX_BYTES = 512 * 1024;
const TYPES = ["image/png", "image/svg+xml", "image/jpeg", "image/webp"];

/**
 * Whose workspace this is.
 *
 * The logo goes in the nav's top-left, replacing the wordmark entirely when
 * one is set — a logo beside the word it spells reads as a mistake. Stored in
 * settings rather than committed to the repo so handing this to a different
 * client is an upload, not a deploy.
 */
export function BrandingForm({
  brandName,
  clientName,
  logoUrl,
}: {
  brandName: string | null;
  clientName: string | null;
  logoUrl: string | null;
}) {
  const toast = useToast();
  const router = useRouter();
  const [, startTransition] = useTrackedTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(brandName ?? "");
  const [client, setClient] = useState(clientName ?? "");
  const [preview, setPreview] = useState(logoUrl);
  const [busy, setBusy] = useState(false);

  async function onPick(file: File) {
    if (!TYPES.includes(file.type)) {
      toast.error("PNG, SVG, JPEG or WebP, please.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Keep the logo under 512 KB — it loads on every page.");
      return;
    }

    setBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
      // A fresh key each time: overwriting one path would leave the old image
      // cached at the CDN and the new logo invisible for hours.
      const path = `logo-${Date.now()}.${ext}`;
      const { error } = await supabaseBrowser()
        .storage.from("branding")
        .upload(path, file, { contentType: file.type, upsert: true });
      if (error) throw new Error(error.message);

      const res = await saveBrandingAction({ name, logoPath: path });
      if (res?.error) throw new Error(res.error);

      setPreview(URL.createObjectURL(file));
      toast.success("Logo saved.");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-line bg-card p-4">
      <h2 className="text-sm font-semibold">Branding</h2>
      <p className="mt-0.5 text-xs text-ink-3">
        Shown top-left on every page. The logo replaces the name when one is set.
      </p>

      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wider text-ink-3">
            Workspace name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if ((brandName ?? "") === name.trim()) return;
              startTransition(async () => {
                const res = await saveBrandingAction({ name });
                if (res?.error) toast.error(res.error);
                else {
                  toast.success("Saved.");
                  router.refresh();
                }
              });
            }}
            placeholder="Content Ops"
            className="w-full rounded-lg border border-line bg-raised px-3 py-2 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wider text-ink-3">
            Client&rsquo;s name
          </span>
          <input
            value={client}
            onChange={(e) => setClient(e.target.value)}
            onBlur={() => {
              if ((clientName ?? "") === client.trim()) return;
              startTransition(async () => {
                const res = await saveBrandingAction({ name, clientName: client });
                if (res?.error) toast.error(res.error);
                else {
                  toast.success("Saved.");
                  router.refresh();
                }
              });
            }}
            placeholder="e.g. Adam"
            className="w-full rounded-lg border border-line bg-raised px-3 py-2 text-sm placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
          <span className="mt-1 block text-[11px] text-ink-3">
            Shown to editors, the copywriter and the VA instead of &ldquo;the client&rdquo; or
            &ldquo;the owner&rdquo; — &ldquo;Adam is reviewing&rdquo;, &ldquo;ask Adam to connect
            Instagram&rdquo;.
          </span>
        </label>

        <div>
          <span className="mb-1.5 block text-[11px] uppercase tracking-wider text-ink-3">
            Logo
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-14 min-w-32 items-center justify-center rounded-lg border border-line bg-panel px-3">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="Logo preview" className="h-9 w-auto object-contain" />
              ) : (
                <span className="text-xs text-ink-3">No logo</span>
              )}
            </div>

            <input
              ref={fileRef}
              type="file"
              accept={TYPES.join(",")}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPick(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-line px-3 py-2 text-xs text-ink-2 transition hover:border-accent hover:text-ink disabled:opacity-50"
            >
              {busy ? "Uploading…" : preview ? "Replace" : "Upload a logo"}
            </button>

            {preview ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  startTransition(async () => {
                    const res = await saveBrandingAction({ name, logoPath: null });
                    if (res?.error) toast.error(res.error);
                    else {
                      setPreview(null);
                      router.refresh();
                    }
                  })
                }
                className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs text-ink-3 hover:text-danger"
              >
                <IconTrash size={12} />
                Remove
              </button>
            ) : null}
          </div>
          <p className="mt-1.5 text-[11px] text-ink-3">
            PNG, SVG, JPEG or WebP, under 512 KB. A wide logo on a transparent background works
            best — it sits at 28px tall.
          </p>
        </div>
      </div>
    </section>
  );
}
