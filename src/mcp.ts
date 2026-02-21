#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { executeCommand } from "./cli";
import pkg from "../package.json" with { type: "json" };

const server = new McpServer({
  name: "nomnom",
  version: pkg.version,
});

server.registerTool(
  "nomnom",
  {
    title: "NomNom Numbers",
    description:
      "Nutrition tracking CLI. Pass any nomnom command string. " +
      'Run with command "help" for full usage reference. ' +
      "Returns JSON. " +
      'Examples: "search chicken breast --limit 5", "log eggs --calories 150", "today", "progress"',
    inputSchema: {
      command: z.string().describe("The nomnom CLI command to run, e.g. 'search chicken breast --limit 5'"),
    },
  },
  async ({ command }) => {
    const argv = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')/g)?.map(s => s.replace(/^["']|["']$/g, "")) ?? [];
    const result = await executeCommand(argv);

    const text = result.exitCode === 0
      ? result.stdout
      : result.stderr || `Command failed with exit code ${result.exitCode}`;

    return {
      content: [{ type: "text", text }],
      isError: result.exitCode !== 0,
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
