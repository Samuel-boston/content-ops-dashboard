import { redirect } from "next/navigation";

/** Renamed to /editing-bay. */
export default function ReadyToEditRedirect() {
  redirect("/editing-bay");
}
