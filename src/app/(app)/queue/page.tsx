import { redirect } from "next/navigation";

/** Renamed to /my-work, which is a dashboard rather than just a list. */
export default function QueueRedirect() {
  redirect("/my-work");
}
