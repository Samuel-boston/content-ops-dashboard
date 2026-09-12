import { requireRole } from "@/lib/auth";
import { listSeries } from "@/app/series-actions";
import { SeriesBoard } from "@/components/series/SeriesBoard";

export default async function SeriesPage() {
  await requireRole("owner", "admin");
  const series = await listSeries();
  return <SeriesBoard series={series} />;
}
