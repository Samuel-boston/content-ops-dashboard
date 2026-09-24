export const runtime = "nodejs";

/**
 * An OpenAPI description of the AI door, so a ChatGPT custom GPT can import it as
 * an "Action" (Configure → Actions → Import from URL). The server address is this
 * dashboard's own.
 */
export async function GET(req: Request) {
  const base = (process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin).replace(/\/$/, "");
  const post = {
    type: "object",
    required: ["topic"],
    properties: {
      topic: { type: "string", description: "What the post was about, in a few words." },
      hook: { type: "string", description: "The exact opening line." },
      views: { description: 'View count: 120000, "1.2M" or "350k".', oneOf: [{ type: "number" }, { type: "string" }] },
      link: { type: "string", description: "Link to the post." },
      platform: { type: "string", description: "instagram, tiktok, youtube, linkedin, x or other." },
      creator: { type: "string", description: "The account or channel." },
      format: { type: "string" },
      posted_on: { type: "string", description: "YYYY-MM-DD" },
      notes: { type: "string", description: "Why it worked." },
      source: { type: "string", enum: ["own", "inspiration"] },
    },
  };
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "Content Ops",
      version: "1.0.0",
      description: "Read the client's playbook (offer and ideal client) and add top-performing posts to the dashboard's Top posts list.",
    },
    servers: [{ url: base }],
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
    security: [{ bearer: [] }],
    paths: {
      "/api/ai/playbook": {
        get: {
          operationId: "listPlaybookDocs",
          summary: "List the playbook docs, or read one in full with ?id=",
          description: "The client's offer, ideal client and SOPs. Read these first.",
          parameters: [{ name: "id", in: "query", required: false, schema: { type: "string" }, description: "A doc id from the list, to get its full text." }],
          responses: { "200": { description: "The docs" } },
        },
      },
      "/api/ai/top-posts": {
        get: {
          operationId: "listTopPosts",
          summary: "List the saved top posts, best first",
          parameters: [
            { name: "query", in: "query", schema: { type: "string" } },
            { name: "source", in: "query", schema: { type: "string", enum: ["own", "inspiration"] } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
          ],
          responses: { "200": { description: "The posts" } },
        },
        post: {
          operationId: "addTopPosts",
          summary: "Add posts to the Top posts list",
          description: "Only add posts the user approved. Posts whose link is already saved are skipped.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["posts"], properties: { posts: { type: "array", minItems: 1, maxItems: 50, items: post } } } } } },
          responses: { "200": { description: "How many were added and skipped" } },
        },
      },
    },
  };
  return new Response(JSON.stringify(spec, null, 2), { headers: { "content-type": "application/json" } });
}
