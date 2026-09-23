import { redirect } from "next/navigation";

/**
 * The Drive-folder map was folded into the footage index — the shot-level
 * catalog covers the same ground. Old links and bookmarks land there.
 */
export default function BrollPage() {
  redirect("/library/visuals");
}
