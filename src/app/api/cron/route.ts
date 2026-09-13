import { supabaseAdmin } from "@/lib/supabase/admin";
import { notify, notifyTelegram } from "@/lib/notify";
import { buildDigest, digestHtml, digestTelegram, digestText } from "@/lib/digest";
import { sendEmail } from "@/lib/integrations/email";
import { runPublishJob } from "@/app/publishing-actions";
import { runBackupJob } from "@/lib/backup";
import { STALLED_AFTER_DAYS, STATUS_LABELS, type VideoStatus } from "@/lib/types";

/**
 * Periodic housekeeping. Point a scheduler (Vercel Cron, Netlify Scheduled
 * Functions, cron-job.org …) at `/api/cron?key=$CRON_SECRET` — hourly is plenty.
 *   - flag videos stalled in one stage too long (deduped per video)
 *   - auto-archive unattached references after ~30 days of no activity
 *   - run any due scheduled publish jobs
 *   - once a day: back up every content table to Drive, independent of Supabase
 *   - Mondays: push a weekly stage + priority report to Telegram and inboxes
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (process.env.CRON_SECRET && url.searchParams.get("key") !== process.env.CRON_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }
  const db = supabaseAdmin();
  const now = Date.now();
  const out: Record<string, unknown> = {};

  // --- stalled videos ---
  const { data: active } = await db
    .from("videos")
    .select("id, title, status, stage_entered_at, assigned_editor_id")
    .is("parked_at", null)
    .neq("status", "posted");
  const stalled = (active ?? []).filter((v) => {
    const limit = STALLED_AFTER_DAYS[v.status as VideoStatus];
    return limit && now - new Date(v.stage_entered_at).getTime() > limit * 864e5;
  });

  const { data: managers } = await db
    .from("profiles")
    .select("id")
    .in("role", ["owner", "admin"])
    .eq("active", true);
  const managerIds = (managers ?? []).map((m) => m.id);

  // A video stuck for twice its usual stalled threshold gets escalated
  // rather than just re-flagged: email and Telegram too, not just the
  // in-app bell, since three days of silent in-app nudges clearly haven't
  // been enough. Escalation dedupes on its own title prefix rather than a
  // separate notification kind, so it doesn't need its own DB migration.
  let flagged = 0;
  let escalated = 0;
  for (const v of stalled) {
    const limit = STALLED_AFTER_DAYS[v.status as VideoStatus]!;
    const days = Math.floor((now - new Date(v.stage_entered_at).getTime()) / 864e5);
    const critical = days >= limit * 2;
    const titlePrefix = critical ? "Still stalled" : "Stalled";

    const { data: existing } = await db
      .from("notifications")
      .select("id")
      .eq("kind", "stalled")
      .eq("video_id", v.id)
      .ilike("title", `${titlePrefix}:%`)
      .gte("created_at", new Date(now - 3 * 864e5).toISOString())
      .limit(1)
      .maybeSingle();
    if (existing) continue;

    await notify({
      userIds: [...managerIds, ...(v.assigned_editor_id ? [v.assigned_editor_id] : [])],
      kind: "stalled",
      title: `${titlePrefix}: “${v.title}”`,
      body: critical
        ? `${days} days in ${STATUS_LABELS[v.status as VideoStatus]} — more than double the usual wait. Worth a direct check-in.`
        : `${days} days in ${STATUS_LABELS[v.status as VideoStatus]}.`,
      link: `/videos/${v.id}`,
      videoId: v.id,
      email: critical,
    });
    if (critical) {
      await notifyTelegram(
        `⏱️ <b>Still stalled</b>: “${v.title}” — ${days} days in ${STATUS_LABELS[v.status as VideoStatus]}.`
      );
      escalated++;
    } else {
      flagged++;
    }
  }
  out.stalledFlagged = flagged;
  out.stalledEscalated = escalated;

  // --- reference auto-archive (unattached, ~30d idle) ---
  const cutoff = new Date(now - 30 * 864e5).toISOString();
  const { data: archived } = await db
    .from("reference_items")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .is("video_id", null)
    .in("status", ["open", "used", "dismissed"])
    .lt("last_activity_at", cutoff)
    .select("id");
  out.referencesArchived = archived?.length ?? 0;

  // --- due publish jobs ---
  const { data: due } = await db
    .from("publish_jobs")
    .select("id")
    .eq("status", "scheduled")
    .not("scheduled_for", "is", null)
    .lte("scheduled_for", new Date().toISOString());
  let published = 0;
  for (const j of due ?? []) {
    const r = await runPublishJob(j.id);
    if (r.ok) published++;
  }
  out.publishJobsRun = published;

  // --- daily backup to Drive (03:00 UTC, or ?backup=1 to force) ---
  if (new Date().getUTCHours() === 3 || url.searchParams.get("backup") === "1") {
    out.backup = await runBackupJob();
  }

  // --- weekly report (Mondays, or ?report=1 to force) ---
  if (new Date().getUTCDay() === 1 || url.searchParams.get("report") === "1") {
    out.weeklyReport = await sendWeeklyReport(db, managerIds);
    out.digest = await sendClientDigest(db);
  }

  return Response.json({ ok: true, ...out });
}

/**
 * The weekly report answers two questions: where is everything, and what
 * should be priority going into the coming week. The second half is derived
 * — urgent/high work still unassigned, anything stuck, and what's due to post.
 */
async function sendWeeklyReport(db: ReturnType<typeof supabaseAdmin>, managerIds: string[]) {
  const now = Date.now();
  const { data: videos } = await db
    .from("videos")
    .select("id, title, status, priority, stage_entered_at, post_date, assigned_editor_id")
    .is("parked_at", null);
  const all = videos ?? [];

  const stages: VideoStatus[] = [
    "ready_to_edit",
    "in_progress",
    "in_review",
    "revisions",
    "approved",
  ];
  const counts: Record<string, number> = {};
  for (const s of stages) counts[s] = all.filter((v) => v.status === s).length;

  // --- what should be priority this week ---
  const unclaimedUrgent = all.filter(
    (v) => v.status === "ready_to_edit" && v.priority !== "standard" && !v.assigned_editor_id
  );
  const stuck = all.filter((v) => {
    const limit = STALLED_AFTER_DAYS[v.status as VideoStatus];
    return limit && now - new Date(v.stage_entered_at).getTime() > limit * 864e5;
  });
  const weekEnd = new Date(now + 7 * 864e5).toISOString().slice(0, 10);
  const today = new Date(now).toISOString().slice(0, 10);
  const postingSoon = all.filter(
    (v) => v.status !== "posted" && v.post_date && v.post_date >= today && v.post_date <= weekEnd
  );
  const awaitingReview = all.filter((v) => v.status === "in_review");

  const priorities: string[] = [];
  if (unclaimedUrgent.length)
    priorities.push(
      `${unclaimedUrgent.length} urgent/high video${unclaimedUrgent.length === 1 ? "" : "s"} still unassigned — ${unclaimedUrgent
        .slice(0, 3)
        .map((v) => `“${v.title}”`)
        .join(", ")}`
    );
  if (awaitingReview.length)
    priorities.push(`${awaitingReview.length} waiting on your review`);
  if (stuck.length)
    priorities.push(
      `${stuck.length} stalled — ${stuck.slice(0, 3).map((v) => `“${v.title}”`).join(", ")}`
    );
  if (postingSoon.length)
    priorities.push(`${postingSoon.length} scheduled to post in the next 7 days`);
  if (counts.ready_to_edit === 0) priorities.push("Ready to Edit is empty — more needs filming");
  if (priorities.length === 0) priorities.push("Nothing blocking — the pipeline is clear");

  const lines = [
    "<b>📊 Weekly Content Ops report</b>",
    "",
    "<b>Where everything is</b>",
    ...stages.map((s) => `• ${STATUS_LABELS[s]}: <b>${counts[s]}</b>`),
    "",
    "<b>Priority going into this week</b>",
    ...priorities.map((p) => `→ ${p}`),
  ];

  await notifyTelegram(lines.join("\n"));
  await db.from("automation_events").insert({
    kind: "weekly_report",
    detail: { counts, priorities },
  });

  await notify({
    userIds: managerIds,
    kind: "system",
    title: "Weekly Content Ops report",
    body: `${stages.map((s) => `${STATUS_LABELS[s]} ${counts[s]}`).join(" · ")}\n\nPriority: ${priorities.join("; ")}`,
    link: "/",
    email: true,
  });

  return { counts, priorities };
}


/**
 * The client's Monday email.
 *
 * Separate from the internal weekly report above: that one is an operational
 * summary for whoever runs the pipeline, this one is written to the person
 * paying for it — what went out, what's coming, and what's sitting waiting on
 * them. It's the thing that makes a dashboard get opened rather than forgotten.
 *
 * Skips anyone who has turned email off. `notify_mode: "off"` means off.
 */
async function sendClientDigest(db: ReturnType<typeof supabaseAdmin>) {
  const { data: recipients } = await db
    .from("profiles")
    .select("id, email, full_name, notify_mode")
    .in("role", ["owner", "admin"])
    .eq("active", true)
    .neq("notify_mode", "off");

  const people = recipients ?? [];
  if (!people.length) return { sent: 0, reason: "nobody to send to" };

  const data = await buildDigest(db);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://adam-content-ops.vercel.app";

  let sent = 0;
  const failures: string[] = [];
  for (const p of people) {
    const name = (p.full_name as string)?.split(" ")[0] || "there";
    const res = await sendEmail(
      p.email as string,
      `Your week — ${data.waitingOnYou.length} waiting on you`,
      digestText(data, appUrl, name),
      digestHtml(data, appUrl, name)
    );
    if (res.ok) sent++;
    else failures.push(`${p.email}: ${res.error}`);
  }

  await notifyTelegram(digestTelegram(data));
  await db.from("automation_events").insert({
    kind: "client_digest",
    detail: { sent, failures, waiting: data.waitingOnYou.length, runwayDays: data.runwayDays },
  });

  return { sent, failures };
}
