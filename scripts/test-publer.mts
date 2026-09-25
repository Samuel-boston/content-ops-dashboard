/* eslint-disable @typescript-eslint/no-explicit-any */
// Exercises src/lib/publer-client.ts against a fake Publer API.
//   npx tsx scripts/test-publer.mts
import http from "node:http";
import assert from "node:assert/strict";
import {
  waitForJob,
  listWorkspaces, listAccounts, uploadMedia, uploadMediaStream, importMediaFromUrl, publishReel, publishVideo, videoBody, reelBody, findMedia, readFailures, PublerError,
} from "../src/lib/publer-client.ts";

type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders; body: string };
const seen: Seen[] = [];
let jobPolls = 0;
let failPost = false;
let stuck = false;
let broken = false;
let importPayload: unknown = { media: [{ id: "m-imp", path: "https://cdn/x.mp4", type: "video" }] };

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("latin1");
    seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
    const send = (code: number, j: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    if (req.headers.authorization !== "Bearer-API good") return send(401, { errors: ["Unauthorized"] });
    const u = req.url ?? "";
    if (u === "/workspaces") return send(200, [{ id: "w1", name: "Studio", plan: "business" }, { id: "w2", name: "Other" }]);
    if (u === "/accounts") {
      if (!req.headers["publer-workspace-id"]) return send(403, { errors: ["Permission denied or missing required scope"] });
      return send(200, req.headers["publer-workspace-id"] === "w1"
        ? [{ id: "a1", provider: "instagram", name: "adam.kunder" }, { id: "a2", provider: "tiktok", name: "adam" }]
        : []);
    }
    if (u === "/media") return send(200, { id: "m1", path: "https://cdn/m1.mp4", thumbnail: "t", type: "video", validity: { instagram: { reel: true } } });
    if (u === "/media/from-url") return send(200, { job_id: "j-media" });
    if (u === "/posts/schedule/publish" || u === "/posts/schedule") return send(200, { success: true, data: { job_id: "j-post" } });
    if (u.startsWith("/job_status/")) {
      const id = u.split("/").pop();
      if (broken) return send(500, { errors: ["boom"] });
      if (stuck) return send(200, { success: true, data: { status: "working" } });
      if (id === "j-media") return send(200, { success: true, data: { status: "complete", result: { status: "complete", payload: importPayload } } });
      jobPolls++;
      if (jobPolls < 2) return send(200, { success: true, data: { status: "working" } });
      return send(200, { success: true, data: { status: "complete", result: { status: "complete", payload: { failures: failPost ? [{ account_name: "adam.kunder", provider: "instagram", message: "Video too long" }] : {} } } } });
    }
    send(404, {});
  });
});
await new Promise<void>((r) => server.listen(0, r));
const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const good = { apiKey: "good", baseUrl };

// auth + connect flow
await assert.rejects(() => listWorkspaces({ apiKey: "bad", baseUrl }), (e: PublerError) => e.status === 401 && /API key/.test(e.message));
const ws = await listWorkspaces(good);
assert.deepEqual(ws.map((w) => w.id), ["w1", "w2"]);
await assert.rejects(() => listAccounts(good), (e: PublerError) => e.status === 403 && /Business|permission/i.test(e.message));
const accts = await listAccounts({ ...good, workspaceId: "w1" });
assert.equal(accts.filter((a) => a.provider === "instagram").length, 1);
assert.equal(seen.at(-1)!.headers["publer-workspace-id"], "w1");

// upload (multipart) and the media object it returns
const media = await uploadMedia({ ...good, workspaceId: "w1" }, new Blob(["video-bytes"], { type: "video/mp4" }), "cut.mp4");
assert.equal(media.id, "m1"); assert.equal(media.reelOk, true);
const up = seen.find((s) => s.url === "/media")!;
assert.match(String(up.headers["content-type"]), /multipart\/form-data/);
assert.match(up.body, /name="file"/);

// streamed upload: no buffering, correct length, body intact across chunks
{
  const parts = [new Uint8Array(70_000).fill(65), new Uint8Array(70_000).fill(66), new Uint8Array(5).fill(67)];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const src = new ReadableStream<Uint8Array>({ start(c) { for (const p of parts) c.enqueue(p); c.close(); } });
  const m = await uploadMediaStream({ ...good, workspaceId: "w1" }, src, total, 'we"ird\nname.mp4');
  assert.equal(m.id, "m1");
  const s2 = seen.filter((x) => x.url === "/media").at(-1)!;
  assert.match(String(s2.headers["content-type"]), /^multipart\/form-data; boundary=/);
  assert.equal(Number(s2.headers["content-length"]), Buffer.byteLength(s2.body, "latin1"));
  assert.match(s2.body, /name="file"; filename="we_ird_name.mp4"/);
  assert.equal((s2.body.match(/A/g) ?? []).length >= 70_000, true);
  assert.equal(s2.body.includes("A".repeat(70_000) + "B".repeat(70_000) + "CCCCC\r\n--"), true);
}

// URL import, including the payload shape variants
assert.equal((await importMediaFromUrl({ ...good, workspaceId: "w1" }, "https://x/y.mp4", "y.mp4")).id, "m-imp");
importPayload = [{ id: "m-arr", path: "p", type: "video" }];
assert.equal((await importMediaFromUrl({ ...good, workspaceId: "w1" }, "https://x/y.mp4", "y.mp4")).id, "m-arr");
importPayload = { failures: {} };
await assert.rejects(() => importMediaFromUrl({ ...good, workspaceId: "w1" }, "https://x/y.mp4", "y.mp4"), /didn't say where the file went/);

// posting: a trial reel, then a normal feed reel, then a failure
jobPolls = 0;
const c = { ...good, workspaceId: "w1" };
await publishReel(c, { accountId: "a1", media, caption: "hello", trial: "MANUAL" });
const trialPost = seen.filter((s) => s.url === "/posts/schedule/publish").at(-1)!;
const tb = JSON.parse(trialPost.body);
const ig = tb.bulk.posts[0].networks.instagram;
assert.equal(ig.details.trial_reel, "MANUAL"); assert.equal(ig.details.feed, false); assert.equal(ig.details.type, "reel");
assert.equal(ig.media[0].id, "m1"); assert.equal(ig.text, "hello");
assert.equal(tb.bulk.posts[0].accounts[0].scheduled_at, undefined);

jobPolls = 0;
await publishReel(c, { accountId: "a1", media, caption: "feed", shareToFeed: true, scheduledAt: "2026-10-01T18:00:00.000Z" });
const sched = seen.filter((s) => s.url === "/posts/schedule").at(-1)!;
const sb = JSON.parse(sched.body).bulk.posts[0];
assert.equal(sb.accounts[0].scheduled_at, "2026-10-01T18:00:00.000Z");
assert.equal(sb.networks.instagram.details.trial_reel, undefined); assert.equal(sb.networks.instagram.details.feed, true);

jobPolls = 0; failPost = true;
await assert.rejects(() => publishReel(c, { accountId: "a1", media, caption: "x" }), /Video too long/);
await assert.rejects(() => publishReel(c, { accountId: "a1", media: { ...media, reelOk: false }, caption: "x" }), /9:16/);

// pure helpers
assert.deepEqual(readFailures({ failures: {} }), []);
assert.deepEqual(readFailures({ failures: [{ account_name: "A", message: "no" }] }), ["A: no"]);
assert.equal(findMedia({ deep: { list: [{ id: "z", type: "video" }] } })?.id, "z");
assert.equal(findMedia({ id: "only-an-id" }), null);
assert.equal(reelBody({ accountId: "a", media, caption: "c", trial: "SS_PERFORMANCE" }).bulk.posts[0].networks.instagram.details.trial_reel, "SS_PERFORMANCE");

// other networks: YouTube Short, TikTok, and the same through publishVideo
const yt = videoBody({ network: "youtube", accountId: "y1", media, caption: "desc", title: "My Short" }).bulk.posts[0].networks as Record<string, any>;
assert.equal(yt.youtube.title, "My Short"); assert.equal(yt.youtube.details.type, "short"); assert.equal(yt.youtube.details.privacy, "public");
assert.equal(yt.youtube.media[0].id, "m1");
const tt = videoBody({ network: "tiktok", accountId: "t1", media, caption: "hi" }).bulk.posts[0].networks as Record<string, any>;
assert.equal(tt.tiktok.type, "video"); assert.equal(tt.tiktok.text, "hi");
jobPolls = 0; failPost = false;
await publishVideo(c, { network: "youtube", accountId: "y1", media, caption: "d", title: "T" });
const ytSent = JSON.parse(seen.filter((x) => x.url === "/posts/schedule/publish").at(-1)!.body);
assert.ok(ytSent.bulk.posts[0].networks.youtube);
// instagram through videoBody is the reel shape, with the trial flag
const igt = videoBody({ network: "instagram", accountId: "a1", media, caption: "c", trial: "MANUAL" }).bulk.posts[0].networks as Record<string, any>;
assert.equal(igt.instagram.details.trial_reel, "MANUAL");

// a job that never finishes is "pending" (unknown), not failed: it must not be sent again
stuck = true;
await assert.rejects(() => waitForJob(good, "j-any", { timeoutMs: 150, intervalMs: 20 }), (e: PublerError) => e.pending === true);
// polling that keeps erroring is also unknown, not a failure of the post
stuck = false; broken = true;
await assert.rejects(() => waitForJob(good, "j-any", { timeoutMs: 5000, intervalMs: 5 }), (e: PublerError) => e.pending === true && /Lost touch/.test(e.message));
broken = false;

server.close();
console.log("publer client: all checks passed");
