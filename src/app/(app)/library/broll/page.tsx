import { requireUser } from "@/lib/auth";
import { listBrollCategories } from "@/app/editor-actions";
import { BrollLibrary } from "@/components/BrollLibrary";

export default async function BrollPage() {
  const viewer = await requireUser();
  const categories = await listBrollCategories();
  return (
    <BrollLibrary
      categories={categories}
      canEdit={viewer.role === "owner" || viewer.role === "admin"}
    />
  );
}
