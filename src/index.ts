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

async function main() {
  // Initialize LanceDB tables
  await initializeTables();

  // Create MCP server with tools
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
    },
  });

  // Start the server with stdio transport
  await server.startStdio();
}

main().catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});
