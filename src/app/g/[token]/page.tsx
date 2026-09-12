import { notFound } from "next/navigation";
import { resolveGuestToken } from "@/app/guest-actions";
import { GuestReview } from "@/components/guest/GuestReview";
import { GuestUpload } from "@/components/guest/GuestUpload";
import { GuestAssets } from "@/components/guest/GuestAssets";

export const dynamic = "force-dynamic";

/**
 * The public side. No account, no session — the token in the URL is the whole
 * credential, and it only ever resolves to one video.
 */
export default async function GuestPage({ params }: PageProps<"/g/[token]">) {
  const { token } = await params;
  const view = await resolveGuestToken(token);
  if (!view) notFound();

  return (
    <div className="min-h-screen bg-app">
      <header className="border-b border-line px-4 py-3">
        <p className="text-[11px] uppercase tracking-wider text-ink-3">Content Ops</p>
        <h1 className="text-base font-semibold">{view.video.title}</h1>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 py-5">
        {view.purpose === "upload" ? (
          <GuestUpload token={token} videoTitle={view.video.title} />
        ) : view.purpose === "assets" ? (
          <GuestAssets
            videoTitle={view.video.title}
            brief={view.video.brief}
            footage={view.assets?.footage ?? []}
            references={view.assets?.references ?? []}
          />
        ) : (
          <GuestReview token={token} view={view} />
        )}
      </main>
    </div>
  );
}
