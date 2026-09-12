import { requireUser, isManager } from "@/lib/auth";
import { listSop } from "@/app/library-actions";
import { SopBoard } from "@/components/SopBoard";

export default async function SopPage() {
  const viewer = await requireUser();
  const docs = await listSop();
  return <SopBoard docs={docs} canEdit={isManager(viewer.role)} />;
}
