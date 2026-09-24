import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

import { DONE_KEEP_HOURS } from "@/lib/task-hours";

export async function purgeOldDoneTasks(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - DONE_KEEP_HOURS * 3600e3).toISOString();
    await supabaseAdmin().from("va_tasks").delete().eq("status", "done").lt("done_at", cutoff);
  } catch {
    /* housekeeping only */
  }
}
