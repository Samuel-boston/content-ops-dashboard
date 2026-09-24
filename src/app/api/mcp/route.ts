import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { resolveMcpUser } from "@/lib/mcp/auth";
import * as tools from "@/lib/mcp/tools";
import type { Profile } from "@/lib/types";

export const runtime = "nodejs";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

/** One MCP server per request, its tools bound to whichever profile the bearer token resolved to. */
function buildServer(profile: Profile) {
  const server = new McpServer({ name: "content-ops-dashboard", version: "1.0.0" });

  server.registerTool(
    "list_videos",
    {
      title: "List videos",
      description:
        "List videos in the dashboard, optionally filtered by pipeline stage, a title search, or a post-date range. " +
        "Every video comes back with a direct link into the dashboard.",
      inputSchema: tools.listVideosSchema.shape,
    },
    async (args) => {
      try {
        return ok(await tools.listVideos(profile, args));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  server.registerTool(
    "get_video",
    {
      title: "Get video",
      description: "Get full detail for one video by id, including its brief, script, and hooks.",
      inputSchema: tools.getVideoSchema.shape,
    },
    async (args) => {
      try {
        return ok(await tools.getVideo(profile, args));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  server.registerTool(
    "create_idea",
    {
      title: "Create idea",
      description:
        "Add a new video idea to the Ideation shelf — for moving ideas you liked out of a brainstorm and into " +
        "the dashboard. Owner/admin only.",
      inputSchema: tools.createIdeaSchema.shape,
    },
    async (args) => {
      try {
        return ok(await tools.createIdea(profile, args));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  server.registerTool(
    "save_script",
    {
      title: "Save script",
      description:
        "Write a finished script (body, hooks, and/or CTA) onto an existing video — for pasting in a script you " +
        "iterated on elsewhere. script_hooks replaces the full hook list, so pass every hook you want kept.",
      inputSchema: tools.saveScriptSchema.shape,
    },
    async (args) => {
      try {
        return ok(await tools.saveScript(profile, args));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  server.registerTool(
    "set_stage",
    {
      title: "Move a video between planning stages",
      description:
        "Move a video through the scripting pipeline — e.g. once a script is final, set it to script_review so the " +
        "client sees it, or pull an idea into scripting. Copywriters can use ideation, scripting and script_review; " +
        "owners and admins can also use script_revisions and ready_to_film.",
      inputSchema: tools.setStageSchema.shape,
    },
    async (args) => {
      try {
        return ok(await tools.setStage(profile, args));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  server.registerTool(
    "add_hook_variants",
    {
      title: "Add hook variants",
      description: "Append one or more hook variations to a video's existing hooks (no duplicates).",
      inputSchema: tools.addHookVariantsSchema.shape,
    },
    async (args) => {
      try {
        return ok(await tools.addHookVariants(profile, args));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  server.registerTool(
    "message_editor",
    {
      title: "Message about a video",
      description:
        "Post a message on a video's chat thread and notify whoever's on the other side of it — the assigned " +
        "editor if you're the owner/admin, or the video's creator if you're the editor.",
      inputSchema: tools.messageEditorSchema.shape,
    },
    async (args) => {
      try {
        return ok(await tools.messageEditor(profile, args));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  return server;
}

async function handle(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization");
  const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const profile = await resolveMcpUser(bearer);
  if (!profile) {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32001, message: "Invalid or missing access token." }, id: null },
      { status: 401 }
    );
  }

  const server = buildServer(profile);
  const transport = new WebStandardStreamableHTTPServerTransport();
  await server.connect(transport);
  return transport.handleRequest(req);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
