/**
 * DealInSec MCP server (stdio): lets an MCP client on the operator's own machine READ this workspace's Client Radar,
 * leads and Social Intent data, through the same services the app uses. Read-only by design — see server/mcp/tools.ts
 * for exactly what is offered and why nothing that changes anything is.
 *
 * It runs locally, as a process the operator starts, speaking MCP over stdin/stdout. It is NOT a network endpoint:
 * there is no port, no token and nothing to expose. It acts as ONE workspace member, named by email, with that
 * member's own role — it can read nothing they couldn't read in the app. Whoever can run this already holds the
 * database URL, so it grants nothing new; a hosted MCP endpoint would need per-user API tokens, revocation and an
 * approval flow first, and is deliberately not built here.
 *
 *   DEALINSEC_MCP_USER_EMAIL=you@example.com DATABASE_URL=postgresql://… npx tsx script/mcp-server.ts
 *
 * In an MCP client's config:
 *   { "command": "npx", "args": ["tsx", "script/mcp-server.ts"], "cwd": "/path/to/Dealinsec",
 *     "env": { "DEALINSEC_MCP_USER_EMAIL": "you@example.com", "DATABASE_URL": "postgresql://…" } }
 *
 * stdout carries the protocol and nothing else; every log line (one per tool call: tool, outcome, duration — never
 * arguments) goes to stderr.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const log = (kind: string, fields: Record<string, unknown> = {}) => process.stderr.write(`${JSON.stringify({ kind, at: new Date().toISOString(), ...fields })}\n`);
// Anything a module prints while loading must not land on stdout, which is the protocol channel.
console.log = (...a: unknown[]) => process.stderr.write(`${a.map(String).join(" ")}\n`);

async function main() {
  const email = (process.env.DEALINSEC_MCP_USER_EMAIL ?? "").trim().toLowerCase();
  if (!process.env.DATABASE_URL) { log("mcp_config_error", { missing: "DATABASE_URL" }); process.exit(1); }
  if (!email) { log("mcp_config_error", { missing: "DEALINSEC_MCP_USER_EMAIL" }); process.exit(1); }

  const { storage } = await import("../server/storage");
  const user = await storage.getUserByEmail(email);
  if (!user) { log("mcp_config_error", { reason: "no_such_user" }); process.exit(1); }
  if (!user.organizationId) { log("mcp_config_error", { reason: "user_has_no_workspace" }); process.exit(1); }

  // Order matters. server/agent/wiring and the tool registry import each other, and wiring reads the registry while
  // it loads: entered through wiring (as the app enters it) the cycle resolves; entered through the registry it
  // fails with "Cannot access 'AGENT_TOOLS' before initialization". So wiring is loaded first, on purpose.
  await import("../server/agent/wiring");
  const { AGENT_TOOLS } = await import("../server/agent/tools");
  const social = await import("../server/social/service");
  const { createCaller, mcpTools, socialTools, toSpecs } = await import("../server/mcp/tools");
  const tools = mcpTools(AGENT_TOOLS, socialTools({ overview: social.overview, list: social.list }));
  const call = createCaller({ tools, user: user as any, audit: (e) => log("mcp_tool_call", e) });

  const server = new Server({ name: "dealinsec", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toSpecs(tools) }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => (await call(req.params.name, req.params.arguments)) as any);
  await server.connect(new StdioServerTransport());
  const dbHost = (() => { try { return new URL(process.env.DATABASE_URL!).host; } catch { return "unknown"; } })();
  log("mcp_started", { tools: tools.length, dbHost, userId: user.id, orgId: user.organizationId });
}

main().catch((e) => { log("mcp_crashed", { errorType: (e as Error)?.name ?? "Error" }); process.exit(1); });
