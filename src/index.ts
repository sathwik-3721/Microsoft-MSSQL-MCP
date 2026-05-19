#!/usr/bin/env node

// External imports
import * as dotenv from "dotenv";
import sql from "mssql";
import * as http from "http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "crypto";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Internal imports
import { UpdateDataTool } from "./tools/UpdateDataTool.js";
import { InsertDataTool } from "./tools/InsertDataTool.js";
import { ReadDataTool } from "./tools/ReadDataTool.js";
import { CreateTableTool } from "./tools/CreateTableTool.js";
import { CreateIndexTool } from "./tools/CreateIndexTool.js";
import { ListTableTool } from "./tools/ListTableTool.js";
import { DropTableTool } from "./tools/DropTableTool.js";
import { DefaultAzureCredential, InteractiveBrowserCredential } from "@azure/identity";
import { DescribeTableTool } from "./tools/DescribeTableTool.js";
import { ListViewTool } from "./tools/ListViewTool.js";
import { logToolCall, logToolSuccess, logToolError } from "./logger.js";

dotenv.config();

// ── Auth mode detection ──────────────────────────────────────────────────────
//
//  SQL_AUTH      → SQL Server login (SQL_USER + SQL_PASSWORD). No Azure creds needed.
//                  Best for local dev with SSMS-style connections.
//  AZURE_MANAGED → DefaultAzureCredential (Managed Identity / service principal).
//                  Used automatically when deployed to Azure.
//  AZURE_BROWSER → InteractiveBrowserCredential. Fallback for local Azure AD login.
//
type AuthMode = "SQL_AUTH" | "AZURE_MANAGED" | "AZURE_BROWSER";

function detectAuthMode(): AuthMode {
  if (process.env.SQL_USER && process.env.SQL_PASSWORD) return "SQL_AUTH";
  if (
    process.argv.includes("--http") ||
    !!process.env.WEBSITE_INSTANCE_ID ||
    !!process.env.MSI_ENDPOINT ||
    !!process.env.AZURE_CLIENT_ID
  ) return "AZURE_MANAGED";
  return "AZURE_BROWSER";
}

const authMode = detectAuthMode();

// ── Connection pool ──────────────────────────────────────────────────────────
let globalSqlPool: sql.ConnectionPool | null = null;
let globalTokenExpiresOn: Date | null = null;

export async function createSqlConfig(): Promise<sql.config> {
  const trustServerCertificate = process.env.TRUST_SERVER_CERTIFICATE?.toLowerCase() === "true";
  const connectionTimeout = process.env.CONNECTION_TIMEOUT
    ? parseInt(process.env.CONNECTION_TIMEOUT, 10)
    : 30;

  const base: sql.config = {
    server: process.env.SERVER_NAME!,
    database: process.env.DATABASE_NAME!,
    options: { encrypt: true, trustServerCertificate },
    connectionTimeout: connectionTimeout * 1000,
  };

  if (authMode === "SQL_AUTH") {
    // Plain SQL Server / SSMS-style login — no Azure credentials required
    return { ...base, user: process.env.SQL_USER!, password: process.env.SQL_PASSWORD! };
  }

  // Azure AD token auth
  const credential =
    authMode === "AZURE_MANAGED"
      ? new DefaultAzureCredential()
      : new InteractiveBrowserCredential({ redirectUri: "http://localhost" });

  const accessToken = await credential.getToken("https://database.windows.net/.default");
  globalTokenExpiresOn = accessToken?.expiresOnTimestamp
    ? new Date(accessToken.expiresOnTimestamp)
    : new Date(Date.now() + 30 * 60 * 1000);

  return {
    ...base,
    authentication: {
      type: "azure-active-directory-access-token",
      options: { token: accessToken?.token! },
    },
  };
}

// ── Tools ────────────────────────────────────────────────────────────────────
const updateDataTool    = new UpdateDataTool();
const insertDataTool    = new InsertDataTool();
const readDataTool      = new ReadDataTool();
const createTableTool   = new CreateTableTool();
const createIndexTool   = new CreateIndexTool();
const listTableTool     = new ListTableTool();
const dropTableTool     = new DropTableTool();
const describeTableTool = new DescribeTableTool();
const listViewTool      = new ListViewTool();

const isReadOnly = process.env.READONLY === "true";

const allTools = isReadOnly
  ? [listTableTool, listViewTool, readDataTool, describeTableTool]
  : [insertDataTool, readDataTool, describeTableTool, updateDataTool, createTableTool, createIndexTool, dropTableTool, listTableTool, listViewTool];

// ── MCP Server factory ──────────────────────────────────────────────────────
// A new Server instance is created per session so each connection gets its own
// isolated state. Sharing one Server across multiple transports is not supported.
function createMcpServer(): Server {
  const srv = new Server(
    { name: "mssql-mcp-server", version: "0.1.0" },
    { capabilities: { tools: {}, prompts: {} } },
  );

  srv.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: allTools }));

  // Agent frameworks (e.g. protocol 2025-11-25) call prompts/list during init.
  // Return an empty list — this server exposes tools only.
  srv.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [] }));

  srv.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let result;
    switch (name) {
      case insertDataTool.name:
        result = await insertDataTool.run(args);
        break;
      case readDataTool.name:
        result = await readDataTool.run(args);
        break;
      case updateDataTool.name:
        result = await updateDataTool.run(args);
        break;
      case createTableTool.name:
        result = await createTableTool.run(args);
        break;
      case createIndexTool.name:
        result = await createIndexTool.run(args);
        break;
      case listTableTool.name:
        result = await listTableTool.run(args);
        break;
      case dropTableTool.name:
        result = await dropTableTool.run(args);
        break;
      case describeTableTool.name:
        if (!args || typeof args.tableName !== "string") {
          return {
            content: [{ type: "text", text: `Missing or invalid 'tableName' argument for describe_table tool.` }],
            isError: true,
          };
        }
        result = await describeTableTool.run(args as { tableName: string });
        break;
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error occurred: ${error}` }],
      isError: true,
    };
  }
  });

  return srv;
}

// ── HTTP helper ──────────────────────────────────────────────────────────────
function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body, null, 2));
}

/** Read the full request body as a string (for logging only). */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(""));
  });
}

/** Log the JSON-RPC method from a POST body without consuming the stream. */
function logMethod(body: string, sessionId: string | undefined) {
  try {
    const parsed = JSON.parse(body);
    const msgs = Array.isArray(parsed) ? parsed : [parsed];
    for (const msg of msgs) {
      if (msg.method) {
        console.error(`[MCP] session=${sessionId ?? "new"} method=${msg.method}`);
      }
    }
  } catch {
    // not JSON — ignore
  }
}

// ── Server startup ───────────────────────────────────────────────────────────
async function runServer() {
  const useHttp = process.argv.includes("--http") || !!process.env.PORT;

  if (useHttp) {
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

    // Stateful Streamable HTTP: one transport instance per session
    const streamableTransports = new Map<string, StreamableHTTPServerTransport>();
    // Legacy SSE: one transport per session (for older clients)
    const sseTransports = new Map<string, SSEServerTransport>();

    const httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);

      // ── /mcp  (Streamable HTTP — POST + GET, MCP spec 2025-03-26) ──────────
      // Also handles POST /sse since some agent frameworks POST to /sse
      if (url.pathname === "/mcp" || url.pathname === "/sse") {
        if (req.method === "POST") {
          const sessionId = req.headers["mcp-session-id"] as string | undefined;
          const rawBody = await readBody(req);
          logMethod(rawBody, sessionId);
          const parsedBody = rawBody ? JSON.parse(rawBody) : undefined;

          if (sessionId && streamableTransports.has(sessionId)) {
            await streamableTransports.get(sessionId)!.handleRequest(req, res, parsedBody);

          } else if (!sessionId) {
            // New session — pre-register the session ID before handleRequest so
            // that the GET SSE stream (which arrives immediately after the 202)
            // can find the transport in the map without a race condition.
            const newSessionId = randomUUID();
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => newSessionId,
            });
            const mcpServer = createMcpServer();

            streamableTransports.set(newSessionId, transport);

            transport.onclose = () => {
              streamableTransports.delete(newSessionId);
            };

            await mcpServer.connect(transport);
            await transport.handleRequest(req, res, parsedBody);
          } else {
            // Unknown session ID
            sendJson(res, 404, { error: "Session not found" });
          }

        } else if (req.method === "GET" && url.pathname === "/mcp") {
          // Optional: GET on /mcp for SSE notification stream (Streamable HTTP)
          const sessionId = req.headers["mcp-session-id"] as string | undefined;
          if (sessionId && streamableTransports.has(sessionId)) {
            await streamableTransports.get(sessionId)!.handleRequest(req, res);
          } else {
            sendJson(res, 400, { error: "Missing or unknown mcp-session-id" });
          }

        } else if (req.method === "GET" && url.pathname === "/sse") {
          // Legacy SSE GET — kept for backward compatibility with older clients
          const transport = new SSEServerTransport("/messages", res);
          sseTransports.set(transport.sessionId, transport);
          res.on("close", () => sseTransports.delete(transport.sessionId));
          await createMcpServer().connect(transport);

        } else if (req.method === "DELETE") {
          // Session teardown — Streamable HTTP spec requires DELETE support
          const sessionId = req.headers["mcp-session-id"] as string | undefined;
          if (sessionId && streamableTransports.has(sessionId)) {
            await streamableTransports.get(sessionId)!.close();
            streamableTransports.delete(sessionId);
          }
          res.writeHead(200);
          res.end();

        } else {
          sendJson(res, 405, { error: "Method not allowed" });
        }

      // ── /messages  (legacy SSE POST) ───────────────────────────────────────
      } else if (req.method === "POST" && url.pathname === "/messages") {
        const sessionId = url.searchParams.get("sessionId") ?? "";
        const transport = sseTransports.get(sessionId);
        if (!transport) { sendJson(res, 404, { error: "Session not found" }); return; }
        await transport.handlePostMessage(req, res);

      // ── /tools  (REST — list available MCP tools) ──────────────────────────
      } else if (req.method === "GET" && url.pathname === "/tools") {
        process.stderr.write(`[${new Date().toISOString()}] GET /tools — ${allTools.length} tools listed\n`);
        sendJson(res, 200, {
          readonly: isReadOnly,
          count: allTools.length,
          tools: allTools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        });

      // ── /health  (liveness + DB readiness probe) ───────────────────────────
      } else if (req.method === "GET" && url.pathname === "/health") {
        process.stderr.write(`[${new Date().toISOString()}] GET /health\n`);
        const dbStart = Date.now();
        let dbStatus: "connected" | "disconnected" = "disconnected";
        let dbError: string | undefined;
        let dbLatencyMs: number | undefined;
        try {
          await ensureSqlConnection();
          await new sql.Request().query("SELECT 1 AS ping");
          dbLatencyMs = Date.now() - dbStart;
          dbStatus = "connected";
        } catch (err) {
          dbError = err instanceof Error ? err.message : String(err);
        }
        const healthy = dbStatus === "connected";
        process.stderr.write(`[${new Date().toISOString()}] GET /health — db=${dbStatus}${dbLatencyMs !== undefined ? ` latency=${dbLatencyMs}ms` : ""}${dbError ? ` error=${dbError}` : ""}\n`);
        sendJson(res, healthy ? 200 : 503, {
          status: healthy ? "ok" : "degraded",
          authMode,
          database: {
            status: dbStatus,
            ...(dbLatencyMs !== undefined && { latencyMs: dbLatencyMs }),
            ...(dbError && { error: dbError }),
          },
        });

      } else {
        sendJson(res, 404, { error: "Not found" });
      }
    });

    httpServer.listen(port, () => {
      console.error(`MSSQL MCP server listening on port ${port}  [auth: ${authMode}]`);
      console.error(`  MCP endpoint (Streamable HTTP) : http://localhost:${port}/mcp`);
      console.error(`  MCP endpoint (legacy SSE)      : http://localhost:${port}/sse`);
      console.error(`  Tools list                     : http://localhost:${port}/tools`);
      console.error(`  Health check                   : http://localhost:${port}/health`);
    });

  } else {
    // Stdio mode — for local Claude Desktop / VS Code Agent
    const transport = new StdioServerTransport();
    await createMcpServer().connect(transport);
  }
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});

// ── Ensure SQL connection before each tool call ──────────────────────────────
async function ensureSqlConnection() {
  // SQL auth pools never need token refresh — just check connectivity
  const tokenStillValid =
    authMode === "SQL_AUTH" ||
    (globalTokenExpiresOn !== null &&
      globalTokenExpiresOn > new Date(Date.now() + 2 * 60 * 1000));

  if (globalSqlPool && globalSqlPool.connected && tokenStillValid) return;

  const config = await createSqlConfig();

  if (globalSqlPool && globalSqlPool.connected) {
    await globalSqlPool.close();
  }

  globalSqlPool = await sql.connect(config);
}

// ── Wrap all tool .run() to ensure SQL connection + logging before/after each call ─
function wrapToolRun(tool: { name: string; run: (...args: any[]) => Promise<any> }) {
  const originalRun = tool.run.bind(tool);
  tool.run = async function (...args: any[]) {
    const toolArgs = args[0] ?? {};
    logToolCall(tool.name, toolArgs);
    const start = Date.now();
    try {
      await ensureSqlConnection();
      const result = await originalRun(...args);
      logToolSuccess(tool.name, Date.now() - start, result);
      return result;
    } catch (error) {
      logToolError(tool.name, Date.now() - start, error);
      throw error;
    }
  };
}

[insertDataTool, readDataTool, updateDataTool, createTableTool, createIndexTool, dropTableTool, listTableTool, describeTableTool, listViewTool].forEach(wrapToolRun);