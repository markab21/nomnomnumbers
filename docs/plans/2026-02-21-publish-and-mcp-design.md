# Design: npm Publishing + MCP Server

**Date:** 2026-02-21
**Status:** Approved

## Overview

Make NomNom Numbers installable via `bunx nomnomnumbers` and `bun install -g nomnomnumbers`, and add an MCP server layer so AI agents can use it as a tool over stdio.

## Part 1: npm Publishing + bunx Support

### Package identity

- **npm name:** `nomnomnumbers`
- **bin name:** `nomnom` (kept as-is)
- **Usage:** `bunx nomnomnumbers search "chicken"` or `nomnom search "chicken"` after global install

### package.json changes

- Remove `"private": true`
- Add `"files": ["src/", "package.json", "README.md"]` — only ship source + metadata
- Add metadata: `description`, `repository`, `keywords`, `license`, `engines` (Bun >= 1.0)
- Keep `"bin": { "nomnom": "./src/cli.ts" }`

### No build step

Bun runs `.ts` directly. Ship TypeScript source as-is. The shebang `#!/usr/bin/env bun` stays.

### Publishing

Manual `npm publish` from local machine (npm login already configured).

## Part 2: MCP Server

### Architecture

Single MCP tool `nomnom` that wraps the entire CLI. The MCP server imports `db.ts` functions directly — same code path as the CLI, just a different interface.

### Tool definition

```
Tool: nomnom
Parameter: command (string, required)
Description: "Run a NomNom Numbers CLI command. Returns JSON.
  Run with command 'help' for full usage reference."
```

### Examples

```
nomnom({ command: "search chicken breast --limit 5" })
nomnom({ command: "log eggs --calories 150 --protein 12" })
nomnom({ command: "today" })
nomnom({ command: "progress" })
nomnom({ command: "goals --calories 2000" })
nomnom({ command: "help" })
```

### Implementation

- New file: `src/mcp.ts`
- Uses `@modelcontextprotocol/sdk` (single runtime dependency) for stdio framing + JSON-RPC
- Splits command string into argv, runs through the same flag parser and command router
- Captures stdout/stderr instead of writing to process streams
- Returns the same JSON contract the CLI produces

### CLI integration

- `nomnom mcp` subcommand starts the MCP stdio server
- Second bin entry: `"nomnom-mcp": "./src/mcp.ts"` for direct invocation
- Both paths start the same server

### Agent configuration

```json
{
  "mcpServers": {
    "nomnom": {
      "command": "bunx",
      "args": ["nomnomnumbers", "mcp"]
    }
  }
}
```

### Discovery

The `help` command serves as the agent discovery mechanism. The MCP tool description tells the agent to run `help` for full usage. The JSON help output should be compact and complete — all commands, flags, and response shapes.

### Refactoring required

The CLI currently writes directly to stdout/stderr and calls `process.exit()`. To reuse the command logic from MCP:

- Extract command execution into a function that returns `{ stdout: string, stderr: string, exitCode: number }` instead of writing to process streams
- The CLI entry point calls this function and writes to stdout/stderr + exits
- The MCP handler calls this function and returns the result as tool output
- This is the "same pipe" principle — one command router, two interfaces

## Files changed/created

| File | Change |
|------|--------|
| `package.json` | Remove private, add metadata/files/engines, add nomnom-mcp bin |
| `src/cli.ts` | Refactor to extract command router returning result objects |
| `src/mcp.ts` | New — MCP server using @modelcontextprotocol/sdk |
| `AGENTS.md` | Document MCP usage |
