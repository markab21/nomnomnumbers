import http from "node:http";
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
    // Remote HTTP/SSE mode using Node.js http module
    const httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url || "", `http://localhost:${PORT}`);
      await server.startSSE({
        url,
        ssePath: "/sse",
        messagePath: "/message",
        req,
        res,
      });
    });

    httpServer.listen(PORT, () => {
      console.log(`NomNom Numbers MCP server running on http://localhost:${PORT}`);
      console.log(`  SSE endpoint: http://localhost:${PORT}/sse`);
      console.log(`  Message endpoint: http://localhost:${PORT}/message`);
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
