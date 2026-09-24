import { redirect } from "next/navigation";

// The dedicated Publishing page is gone — posting and scheduling happen inside each video (its Post tab).
export default function PublishingPage() {
  redirect("/calendar");
}
