#!/usr/bin/env bun
/**
 * smoke-test-mcp.ts
 * Tests the MCP server end-to-end over JSON-RPC stdio transport.
 * Run: bun scripts/smoke-test-mcp.ts
 */

import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import pkg from "../package.json" with { type: "json" };

const dataDir = process.env.NOMNOM_DATA_DIR ?? join(homedir(), ".local", "share", "nomnom");
const dbPath = join(dataDir, "nomnom.db");
const projectRoot = new URL("..", import.meta.url).pathname;

// Clean meal database
for (const suffix of ["", "-wal", "-shm"]) {
  const p = dbPath + suffix;
  if (existsSync(p)) rmSync(p);
}

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failed++;
    const msg = detail ? `${name}: ${detail}` : name;
    failures.push(msg);
    console.log(`✗ ${msg}`);
  }
}

// ---- MCP Server Process Management ----

let msgId = 0;

function makeRequest(method: string, params?: object): object {
  return {
    jsonrpc: "2.0",
    id: ++msgId,
    method,
    ...(params !== undefined ? { params } : {}),
  };
}

function makeNotification(method: string, params?: object): object {
  return {
    jsonrpc: "2.0",
    method,
    ...(params !== undefined ? { params } : {}),
  };
}

interface McpProcess {
  proc: ReturnType<typeof Bun.spawn>;
  send: (msg: object) => void;
  readResponse: () => Promise<any>;
  kill: () => void;
}

function spawnMcp(): McpProcess {
  const proc = Bun.spawn(["bun", "src/mcp.ts"], {
    cwd: projectRoot,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  let buffer = "";
  const lines: string[] = [];
  let resolveWaiter: ((line: string) => void) | null = null;

  // Read stdout as a stream
  const reader = proc.stdout.getReader();

  function processChunk(chunk: string): void {
    buffer += chunk;
    while (true) {
      const idx = buffer.indexOf("\n");
      if (idx === -1) break;
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      if (line.trim()) {
        if (resolveWaiter) {
          const resolve = resolveWaiter;
          resolveWaiter = null;
          resolve(line);
        } else {
          lines.push(line);
        }
      }
    }
  }

  // Continuously read from stdout
  (async () => {
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        processChunk(decoder.decode(value, { stream: true }));
      }
    } catch {
      // Process exited
    }
  })();

  function send(msg: object): void {
    proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  function readResponse(): Promise<any> {
    return new Promise((resolve, reject) => {
      // Check if we already have a line buffered
      if (lines.length > 0) {
        const line = lines.shift()!;
        try {
          resolve(JSON.parse(line));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${line}`));
        }
        return;
      }
      // Wait for next line
      const timeout = setTimeout(() => {
        resolveWaiter = null;
        reject(new Error("Timeout waiting for MCP response (5s)"));
      }, 5000);

      resolveWaiter = (line: string) => {
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(line));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${line}`));
        }
      };
    });
  }

  function kill(): void {
    try {
      proc.stdin.end();
    } catch {}
    proc.kill();
  }

  return { proc, send, readResponse, kill };
}

// ---- Tests ----

const mcp = spawnMcp();

try {
  // ============================================================
  // Test 1: Initialize handshake
  // ============================================================
  console.log("--- Test 1: Initialize handshake ---");

  mcp.send(makeRequest("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "1.0.0" },
  }));

  const initResp = await mcp.readResponse();
  check("Initialize returns result", initResp.result !== undefined, `got: ${JSON.stringify(initResp).slice(0, 200)}`);
  check("Server name is nomnom", initResp.result?.serverInfo?.name === "nomnom", `got: ${initResp.result?.serverInfo?.name}`);
  check("Server version matches package.json", initResp.result?.serverInfo?.version === pkg.version, `got: ${initResp.result?.serverInfo?.version}, expected: ${pkg.version}`);

  // Send initialized notification (required before tool calls)
  mcp.send(makeNotification("notifications/initialized"));

  // Small delay for the notification to be processed
  await Bun.sleep(100);

  // ============================================================
  // Test 2: tools/list returns single tool named "nomnom"
  // ============================================================
  console.log("\n--- Test 2: tools/list ---");

  mcp.send(makeRequest("tools/list"));
  const listResp = await mcp.readResponse();
  check("tools/list returns result", listResp.result !== undefined, `got: ${JSON.stringify(listResp).slice(0, 200)}`);

  const tools = listResp.result?.tools ?? [];
  check("Exactly one tool", tools.length === 1, `got ${tools.length} tools`);
  check("Tool name is nomnom", tools[0]?.name === "nomnom", `got: ${tools[0]?.name}`);

  // ============================================================
  // Test 3: tools/call with "help" returns help text
  // ============================================================
  console.log("\n--- Test 3: tools/call help ---");

  mcp.send(makeRequest("tools/call", {
    name: "nomnom",
    arguments: { command: "help" },
  }));
  const helpResp = await mcp.readResponse();
  check("Help returns result", helpResp.result !== undefined, `got: ${JSON.stringify(helpResp).slice(0, 200)}`);
  check("Help is not error", helpResp.result?.isError !== true, `isError: ${helpResp.result?.isError}`);

  const helpText = helpResp.result?.content?.[0]?.text ?? "";
  check("Help text contains nomnom", helpText.toLowerCase().includes("nomnom"), `text: ${helpText.slice(0, 100)}`);
  check("Help text contains command descriptions", helpText.includes("search") && helpText.includes("log"), `text: ${helpText.slice(0, 200)}`);

  // ============================================================
  // Test 4: tools/call with log command returns success
  // ============================================================
  console.log("\n--- Test 4: tools/call log ---");

  mcp.send(makeRequest("tools/call", {
    name: "nomnom",
    arguments: { command: "log TestFood --calories 100" },
  }));
  const logResp = await mcp.readResponse();
  check("Log returns result", logResp.result !== undefined, `got: ${JSON.stringify(logResp).slice(0, 200)}`);
  check("Log is not error", logResp.result?.isError !== true, `isError: ${logResp.result?.isError}`);

  const logText = logResp.result?.content?.[0]?.text ?? "";
  let logJson: any = {};
  try {
    logJson = JSON.parse(logText);
  } catch {
    logJson = {};
  }
  check("Log response has success: true", logJson.success === true, `text: ${logText.slice(0, 200)}`);

  // ============================================================
  // Test 5: tools/call with "today" includes logged meal
  // ============================================================
  console.log("\n--- Test 5: tools/call today ---");

  mcp.send(makeRequest("tools/call", {
    name: "nomnom",
    arguments: { command: "today" },
  }));
  const todayResp = await mcp.readResponse();
  check("Today returns result", todayResp.result !== undefined, `got: ${JSON.stringify(todayResp).slice(0, 200)}`);
  check("Today is not error", todayResp.result?.isError !== true, `isError: ${todayResp.result?.isError}`);

  const todayText = todayResp.result?.content?.[0]?.text ?? "";
  let todayJson: any = {};
  try {
    todayJson = JSON.parse(todayText);
  } catch {
    todayJson = {};
  }
  check("Today contains TestFood", todayText.includes("TestFood"), `text: ${todayText.slice(0, 300)}`);
  check("Today has meals array", Array.isArray(todayJson.meals), `got: ${typeof todayJson.meals}`);
  check("Today totals include calories", todayJson.totals?.calories === 100, `got: ${todayJson.totals?.calories}`);

  // ============================================================
  // Test 6: tools/call with invalid command returns isError
  // ============================================================
  console.log("\n--- Test 6: tools/call invalid command ---");

  mcp.send(makeRequest("tools/call", {
    name: "nomnom",
    arguments: { command: "badcommand" },
  }));
  const badResp = await mcp.readResponse();
  check("Invalid command returns result", badResp.result !== undefined, `got: ${JSON.stringify(badResp).slice(0, 200)}`);
  check("Invalid command has isError: true", badResp.result?.isError === true, `isError: ${badResp.result?.isError}`);

} finally {
  mcp.kill();
}

// ---- Summary ----
console.log(`\n${"=".repeat(50)}`);
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log("ALL CHECKS PASSED");
  process.exit(0);
}
