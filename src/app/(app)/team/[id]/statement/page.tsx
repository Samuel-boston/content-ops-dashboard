import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { editorMonthEarnings, listPayments } from "@/app/pricing-actions";
import { getWorkspaceSettings } from "@/lib/workspace";
import { PrintButton } from "@/components/team/PrintButton";
import { dayMonth, displayName, money } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

/**
 * A statement someone can actually pay from — the month's line items and one
 * total, and nothing else. Deliberately its own page rather than printing the
 * editor screen, which would put rates and time off in front of whoever
 * receives it.
 */
export default async function StatementPage({ params, searchParams }: PageProps<"/team/[id]/statement">) {
  const { id } = await params;
  const sp = await searchParams;
  const viewer = await requireUser();

  // Pay is between the client and that editor. Admins don't see it.
  if (viewer.role !== "owner" && viewer.id !== id) notFound();

  const month =
    typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month)
      ? sp.month
      : new Date().toISOString().slice(0, 7);

  const supabase = await supabaseServer();
  const [{ data: editor }, earnings, payments, settings] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email").eq("id", id).maybeSingle(),
    editorMonthEarnings(id, month),
    listPayments(id),
    getWorkspaceSettings(),
  ]);

  if (!editor || !earnings) notFound();
  const currency = settings.currency ?? "USD";
  const paid = payments.find((p) => p.month === month) ?? null;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5 flex items-center gap-2 print:hidden">
        <Link href={`/team/${id}?month=${month}`} className="text-sm text-ink-3 hover:text-ink">
          ← Back
        </Link>
        <PrintButton className="ml-auto" />
      </div>

      <article className="rounded-2xl border border-line bg-card p-8 print:border-0 print:bg-transparent print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-ink-3">Statement</p>
            <h1 className="mt-0.5 text-xl font-semibold">{monthLabel(month)}</h1>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium">{displayName(editor)}</p>
            <p className="text-xs text-ink-3">{editor.email}</p>
          </div>
        </header>

        {earnings.videos.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-3">
            Nothing posted in {monthLabel(month)}.
          </p>
        ) : (
          <table className="mt-5 w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-ink-3">
                <th className="pb-2 font-semibold">Video</th>
                <th className="pb-2 font-semibold">Format</th>
                <th className="pb-2 text-right font-semibold">Variants</th>
                <th className="pb-2 text-right font-semibold">Posted</th>
                <th className="pb-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {earnings.videos.map((v) => (
                <tr key={v.id}>
                  <td className="border-t border-line py-2 pr-3">{v.title}</td>
                  <td className="border-t border-line py-2 pr-3 text-ink-2">
                    {v.breakdown?.format ?? v.formats[0] ?? "—"}
                  </td>
                  <td className="border-t border-line py-2 text-right text-ink-2 tabular-nums">
                    {v.breakdown?.extra_variants ? `+${v.breakdown.extra_variants}` : "—"}
                  </td>
                  <td className="border-t border-line py-2 text-right text-ink-2">
                    {dayMonth(v.posted_at)}
                  </td>
                  <td className="border-t border-line py-2 text-right tabular-nums">
                    {money(v.price_cents, currency, { maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={4} className="border-t-2 border-line-strong py-3 font-medium">
                  Total · {earnings.count} video{earnings.count === 1 ? "" : "s"}
                </td>
                <td className="border-t-2 border-line-strong py-3 text-right text-lg font-semibold tabular-nums">
                  {money(earnings.total_cents, currency, { maximumFractionDigits: 2 })}
                </td>
              </tr>
            </tbody>
          </table>
        )}

        <footer className="mt-6 border-t border-line pt-4 text-xs text-ink-3">
          {paid ? (
            <p className="text-ok">
              Paid {money(paid.amount_cents, currency, { maximumFractionDigits: 2 })} on{" "}
              {dayMonth(paid.paid_at)}.
            </p>
          ) : (
            <p>Unpaid.</p>
          )}
          <p className="mt-1.5">
            Each amount is the price recorded when the video was posted, so later rate changes
            don&rsquo;t alter this statement.
          </p>
        </footer>
      </article>
    </div>
  );
}
