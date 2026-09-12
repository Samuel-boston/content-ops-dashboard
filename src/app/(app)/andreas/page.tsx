import { requireRole } from "@/lib/auth";
import { AndreasChat } from "@/components/andreas/AndreasChat";
import { IconSparkles } from "@/components/ui/icons";

/**
 * Andreas — the assistant, given the room it needs. Started as an icon in
 * the nav opening a slip of a drawer; the feature outgrew that fast, so
 * this is its own page instead of a bigger drawer.
 */
export default async function AndreasPage() {
  await requireRole("owner", "admin");

  return (
    <div className="mx-auto flex h-[calc(100dvh-7rem)] max-w-3xl flex-col">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-ghost text-accent-hi">
          <IconSparkles size={18} />
        </span>
        <div>
          <h1 className="text-lg font-semibold leading-tight">Ask Andreas</h1>
          <p className="text-xs text-ink-3">
            Finds videos, pulls lists and top performers, and — with a confirm click — moves a
            stage. Reads the real board, never guesses.
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 rounded-2xl border border-line bg-card p-4">
        <AndreasChat />
      </div>
    </div>
  );
}
