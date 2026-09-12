import { requireUser } from "@/lib/auth";
import { listReferences } from "@/app/library-actions";
import { ReferenceHolding } from "@/components/ReferenceHolding";

export default async function ReferencesPage() {
  await requireUser();
  const items = await listReferences(null);
  return <ReferenceHolding items={items} />;
}
