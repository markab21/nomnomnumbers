import http from "node:http";
import { randomUUID } from "node:crypto";
import { MCPServer } from "@mastra/mcp";
import { initializeTables } from "./db";
import {
  searchFood,
  lookupBarcode,
  logMeal,
  getDailySummary,
  getMealHistoryTool,
  searchMeals,
  setGoals,
  getGoals,
  logInteraction,
  searchAuditLog,
} from "./mastra/tools";
import { prompts, getInstructions } from "./prompts";

const PORT = Number(process.env.MCP_PORT) || 3456;

async function main() {
  // Initialize LanceDB tables
  await initializeTables();

  // Create MCP server with tools and prompts
  const server = new MCPServer({
    name: "nomnomnumbers",
    version: "1.0.0",
    tools: {
      searchFood,
      lookupBarcode,
      logMeal,
      getDailySummary,
      getMealHistory: getMealHistoryTool,
      searchMeals,
      setGoals,
      getGoals,
      logInteraction,
      searchAuditLog,
      getInstructions,
    },
    prompts,
  });

  // Check transport mode
  if (process.env.MCP_HTTP === "true") {
    // Remote HTTP mode - supports both Streamable HTTP and legacy SSE
    const httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url || "", `http://localhost:${PORT}`);

      // Streamable HTTP transport (OpenWebUI compatible) at /mcp
      if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
        await server.startHTTP({
          url,
          httpPath: "/mcp",
          req,
          res,
          options: {
            sessionIdGenerator: () => randomUUID(),
          },
        });
        return;
      }

      // Legacy SSE transport at /sse and /message
      if (url.pathname === "/sse" || url.pathname === "/message") {
        await server.startSSE({
          url,
          ssePath: "/sse",
          messagePath: "/message",
          req,
          res,
        });
        return;
      }

      // Health check / info endpoint
      if (url.pathname === "/" || url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          name: "nomnomnumbers",
          version: "1.0.0",
          status: "ok",
          transports: {
            streamableHttp: "/mcp",
            sse: "/sse",
          },
        }));
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    httpServer.listen(PORT, () => {
      console.log(`NomNom Numbers MCP server running on http://localhost:${PORT}`);
      console.log(`  Streamable HTTP: http://localhost:${PORT}/mcp (OpenWebUI compatible)`);
      console.log(`  SSE endpoint:    http://localhost:${PORT}/sse`);
      console.log(`  Health check:    http://localhost:${PORT}/health`);
    });
  } else {
    // Local stdio mode (default)
    await server.startStdio();
  }
}

main().catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});
