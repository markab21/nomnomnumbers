# npm Publishing + MCP Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make NomNom Numbers publishable to npm (`bunx nomnomnumbers`) and add an MCP server layer (`nomnom mcp`) that wraps the CLI as a single `nomnom` tool.

**Architecture:** Refactor `cli.ts` to separate the command router (returns result objects) from the entry point (writes to stdout/exits). Create `mcp.ts` that registers one tool calling the same router. Ship as npm package with two bin entries.

**Tech Stack:** Bun runtime, `@modelcontextprotocol/sdk` v1.x + `zod` for MCP server

---

### Task 1: Refactor CLI — Extract command router from entry point

The CLI currently writes directly to stdout/stderr and calls `process.exit()`. We need to separate the "execute command" logic from the "write output and exit" logic so the MCP server can reuse it.

**Files:**
- Modify: `src/cli.ts`

**Step 1: Create the `CommandResult` type and `executeCommand` function**

Add this type and refactor `main()` to return a result object instead of writing to stdout directly.

The key changes:

1. Define at the top of the file (after imports):

```typescript
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
```

2. Rename the current `main()` to `executeCommand(argv: string[]): Promise<CommandResult>`. This function:
   - Takes an argv array (e.g. `["search", "chicken", "--limit", "5"]`)
   - Instead of calling `console.log()`, captures output into a `stdout` string
   - Instead of calling `console.error()`, captures output into a `stderr` string
   - Instead of calling `process.exit(1)`, returns `{ exitCode: 1, ... }`
   - Returns `{ stdout, stderr, exitCode: 0 }` on success

The refactoring approach:
- Create local `let stdout = ""; let stderr = "";` at the top of `executeCommand`
- Replace `printResult` with a local version that appends to `stdout` instead of `console.log`
- Replace `printError` with throwing a sentinel error (e.g. `class CliError extends Error`) that gets caught at the top level to set `exitCode: 1` and append to `stderr`
- Replace `console.error(...)` calls (for USDA download progress) with appending to `stderr`
- The `humanMode` flag is parsed from `argv` inside `executeCommand`

3. Keep a thin `main()` at the bottom that calls `executeCommand(process.argv.slice(2))` and writes the result to actual stdout/stderr/process.exit:

```typescript
if (import.meta.main) {
  const result = await executeCommand(process.argv.slice(2));
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.stdout) process.stdout.write(result.stdout);
  process.exit(result.exitCode);
}
```

**Step 2: Verify refactoring didn't break anything**

Run: `bun run typecheck`
Run: `bun run smoke:tolerance`
Run: `bun run smoke:goals`

All must pass with identical behavior.

**Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "refactor: extract executeCommand from CLI entry point"
```

---

### Task 2: Create MCP server

**Files:**
- Create: `src/mcp.ts`

**Step 1: Install dependencies**

```bash
bun add @modelcontextprotocol/sdk zod
```

**Step 2: Write `src/mcp.ts`**

```typescript
#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { executeCommand } from "./cli.js";

const server = new McpServer({
  name: "nomnom",
  version: "2.1.0",
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
    const argv = command.match(/(?:[^\s"]+|"[^"]*")/g)?.map(s => s.replace(/^"|"$/g, "")) ?? [];
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
```

Note: The import uses `./cli.js` because the MCP SDK uses standard ESM resolution. Bun resolves `.js` to `.ts` automatically.

**Step 3: Verify MCP server starts**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}' | bun src/mcp.ts
```

Should receive a JSON-RPC response with server info.

**Step 4: Commit**

```bash
git add src/mcp.ts
git commit -m "feat: add MCP server with single nomnom tool"
```

---

### Task 3: Add `mcp` subcommand to CLI

**Files:**
- Modify: `src/cli.ts`

**Step 1: Add `mcp` case to the command switch**

In the `executeCommand` function, add a case before the `default:` branch:

```typescript
case "mcp": {
  // Import and start MCP server — this takes over stdio, never returns
  await import("./mcp.js");
  // executeCommand will never reach here; mcp.ts connects to stdio and blocks
  return { stdout: "", stderr: "", exitCode: 0 };
}
```

Wait — this won't work cleanly because `executeCommand` captures stdout. The `mcp` case is special: it needs raw access to stdin/stdout for the JSON-RPC transport.

Better approach: handle `mcp` in the `if (import.meta.main)` block BEFORE calling `executeCommand`:

```typescript
if (import.meta.main) {
  if (process.argv[2] === "mcp") {
    await import("./mcp.js");
  } else {
    const result = await executeCommand(process.argv.slice(2));
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.stdout) process.stdout.write(result.stdout);
    process.exit(result.exitCode);
  }
}
```

Also add `mcp` to the help text:

```
  mcp                         Start MCP server (stdio transport)
```

**Step 2: Test**

```bash
bun start mcp
# Should block waiting for JSON-RPC input (Ctrl+C to exit)
```

**Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add mcp subcommand to CLI"
```

---

### Task 4: Prepare package.json for npm publishing

**Files:**
- Modify: `package.json`

**Step 1: Update package.json**

Changes:
- Remove `"private": true`
- Keep `"name": "nomnomnumbers"`
- Bump version to `2.1.0` (new feature: MCP)
- Add `"description"`, `"repository"`, `"license"`, `"keywords"`
- Add `"files": ["src/", "README.md"]`
- Add `"engines": { "bun": ">=1.0.0" }`
- Add second bin entry: `"nomnom-mcp": "./src/mcp.ts"`
- Move `@modelcontextprotocol/sdk` and `zod` to `dependencies`

Final package.json:

```json
{
  "name": "nomnomnumbers",
  "version": "2.1.0",
  "description": "Nutrition tracking CLI for AI agents — food search, barcode lookup, meal logging with JSON output",
  "module": "src/cli.ts",
  "type": "module",
  "bin": {
    "nomnom": "./src/cli.ts",
    "nomnom-mcp": "./src/mcp.ts"
  },
  "files": ["src/", "README.md"],
  "scripts": {
    "start": "bun run src/cli.ts",
    "dev": "bun --watch run src/cli.ts",
    "typecheck": "bunx tsc --noEmit",
    "import:usda": "bun run src/db/usda-import.ts",
    "seed:month": "bun scripts/seed-month.ts",
    "smoke:month": "bun scripts/smoke-test-month.ts",
    "smoke:goals": "bun scripts/smoke-test-goals.ts",
    "smoke:tolerance": "bun scripts/smoke-test-tolerance.ts"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/markab21/nomnomnumbers.git"
  },
  "keywords": ["nutrition", "food", "tracking", "cli", "mcp", "ai", "agents"],
  "license": "MIT",
  "engines": {
    "bun": ">=1.0.0"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.26.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/bun": "latest"
  },
  "peerDependencies": {
    "typescript": "^5"
  }
}
```

**Step 2: Verify clean install and typecheck**

```bash
bun install
bun run typecheck
```

**Step 3: Test the package tarball**

```bash
npm pack --dry-run
```

Verify only `src/`, `README.md`, and `package.json` are included. No `scripts/`, `docs/`, `data/`.

**Step 4: Run all smoke tests**

```bash
bun run smoke:tolerance && bun run smoke:goals
```

**Step 5: Commit**

```bash
git add package.json bun.lock
git commit -m "feat: prepare package for npm publishing with MCP support"
```

---

### Task 5: Update AGENTS.md documentation

**Files:**
- Modify: `AGENTS.md`

**Step 1: Add MCP section to AGENTS.md**

Add after the CLI Commands section:

```markdown
## MCP Server

NomNom Numbers includes an MCP (Model Context Protocol) server for AI agent integration.

### Starting the MCP server

\`\`\`bash
nomnom mcp                    # After global install
bunx nomnomnumbers mcp        # Remote execution
nomnom-mcp                    # Direct binary
\`\`\`

### MCP Configuration

For Claude Desktop or similar tools:

\`\`\`json
{
  "mcpServers": {
    "nomnom": {
      "command": "bunx",
      "args": ["nomnomnumbers", "mcp"]
    }
  }
}
\`\`\`

### Tool: nomnom

Single tool that accepts any CLI command string and returns JSON.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| command | string | yes | CLI command to run, e.g. "search chicken breast --limit 5" |

The tool returns the same JSON the CLI outputs. Run with command "help" for full usage.
\`\`\`

Also add to the Build & Development Commands section:

```markdown
npm publish                    # Publish to npm (requires npm login)
npm pack --dry-run             # Preview published files
```

**Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: add MCP server and npm publishing documentation"
```

---

### Task 6: Smoke test MCP server end-to-end

**Files:**
- Create: `scripts/smoke-test-mcp.ts`

**Step 1: Write MCP smoke test**

The test spawns the MCP server process, sends JSON-RPC messages over stdin, and verifies responses.

Test cases:
1. Initialize handshake succeeds
2. `tools/list` returns exactly one tool named `nomnom`
3. `tools/call` with `command: "help"` returns help text (exit 0, not isError)
4. `tools/call` with `command: "log TestFood --calories 100"` returns success JSON
5. `tools/call` with `command: "today"` returns today's summary including the logged meal
6. `tools/call` with invalid command returns `isError: true`

**Step 2: Add smoke script to package.json**

```json
"smoke:mcp": "bun scripts/smoke-test-mcp.ts"
```

**Step 3: Run it**

```bash
bun run smoke:mcp
```

All checks must pass.

**Step 4: Commit**

```bash
git add scripts/smoke-test-mcp.ts package.json
git commit -m "test: add MCP server smoke test"
```

---

### Task 7: Publish to npm

**Step 1: Final verification**

```bash
bun run typecheck
bun run smoke:tolerance
bun run smoke:goals
bun run smoke:mcp
npm pack --dry-run
```

**Step 2: Publish**

```bash
npm publish
```

**Step 3: Verify remote execution**

```bash
bunx nomnomnumbers help
bunx nomnomnumbers search "test" 2>&1 || true
```

**Step 4: Tag release**

```bash
git tag v2.1.0
git push origin main --tags
```
