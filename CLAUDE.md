# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NomNom Numbers is an MCP server for nutrition/calorie tracking. It provides AI-powered food search, meal logging, and goal tracking through the Model Context Protocol.

## Architecture

- **@mastra/mcp** - MCP server framework for exposing tools
- **@mastra/core** - Mastra tools and agent framework
- **LanceDB** - Embedded vector database for semantic search and data storage
- **xAI/Grok** - LLM for agent reasoning
- **OpenAI** - Embeddings only (`text-embedding-3-small`)

### Key Components

```
src/
├── index.ts                 # MCP server entry point
├── types.ts                 # Shared TypeScript types
├── db/
│   ├── index.ts             # LanceDB connection and operations
│   ├── schemas.ts           # Zod validation schemas
│   └── embeddings.ts        # OpenAI embedding functions
└── mastra/
    ├── index.ts             # Mastra instance
    ├── agents/
    │   └── nutrition-agent.ts  # Main AI agent
    └── tools/
        ├── food-tools.ts    # Food search and barcode lookup
        ├── meal-tools.ts    # Meal logging and summaries
        ├── goal-tools.ts    # User goal management
        └── audit-tools.ts   # Conversation audit logging
```

## Tech Stack

- **Runtime**: Bun v1.3.4+
- **Language**: TypeScript 5 (strict mode enabled)
- **Module System**: ESM with bundler resolution

## Development Commands

```bash
# Install dependencies
bun install

# Start MCP server
bun run start

# Start with watch mode
bun run dev

# Type checking
bun run typecheck

# Run all tests
bun test

# Run specific test file
bun test tests/unit/db.test.ts
```

## Environment Variables

Create a `.env` file with:

```
XAI_API_KEY=...           # For xAI/Grok model
OPENAI_API_KEY=...        # For embeddings only
USDA_FDC_API_KEY=...      # For USDA FoodData Central API (get key at fdc.nal.usda.gov)
```

## MCP Integration

### Local (stdio) Mode

Add to Claude Code's `.mcp.json`:

```json
{
  "mcpServers": {
    "nomnomnumbers": {
      "command": "bun",
      "args": ["run", "/path/to/nomnomnumbers/src/index.ts"]
    }
  }
}
```

Set environment variables in your shell profile (`.zshrc`, `.bashrc`, etc.) or use a `.env` file in the project root. The MCP server will inherit environment variables from your shell.

### Remote (HTTP/SSE) Mode

Start the server in HTTP mode:

```bash
bun run start:http    # Production
bun run dev:http      # Development with watch
```

Default port is 3456. Override with `MCP_PORT` environment variable.

Connect remote clients via URL:

```json
{
  "mcpServers": {
    "nomnomnumbers": {
      "type": "sse",
      "url": "http://localhost:3456/sse"
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `search_food` | Semantic search for foods |
| `lookup_barcode` | Find food by barcode |
| `log_meal` | Record a meal entry |
| `get_daily_summary` | Today's calorie/macro totals |
| `get_meal_history` | Past meal entries |
| `set_user_goals` | Set calorie/macro targets |
| `get_user_goals` | Get user's targets |
| `search_meals` | Semantic search past meals |
| `log_interaction` | Audit trail logging |
| `search_audit_log` | Search conversation history |

## Database

LanceDB stores data in `./data/lance/` with four tables:
- `foods` - Food database with embeddings
- `meal_logs` - User meal tracking ledger
- `audit_logs` - Conversation audit trail
- `user_goals` - Calorie/macro targets

**Important**: All database field names use snake_case (e.g., `user_id`, `food_name`, `meal_type`, `logged_at`). This is required because LanceDB's SQL-like WHERE clauses lowercase unquoted identifiers, making camelCase fields unreachable.

## TypeScript Configuration

The project uses strict TypeScript with these notable settings:
- `noUncheckedIndexedAccess`: Array/object index access returns `T | undefined`
- `noImplicitOverride`: Requires explicit `override` keyword
- `verbatimModuleSyntax`: Type imports must use `import type`

## Oracle MCP (Recommended)

Oracle provides AI-powered tools for development. **Use the `oracle-mcp` CLI directly** - it's agentic and understands natural language queries.

### Quick Reference

| Need | Command |
|------|---------|
| **Library docs** | `oracle-mcp "use context7 to find [library] docs for [topic]"` |
| **Code search** | `oracle-mcp "query" --repo github.com/org/repo` |
| **Web research** | `oracle-mcp -a web "query"` |
| **E2E testing** | `oracle-mcp -a e2e "test instructions"` |

### Context7 for Public Repo Code Search

Include "context7" in your query to search public repositories and library docs:

```bash
# Search public repos for patterns
oracle-mcp "use context7 to find Mastra agent patterns"
oracle-mcp "use context7 to find LanceDB vector search examples"
```

### Sourcegraph for Your Own Repos

Use `--repo` flag or `repo:` syntax for searching your own indexed repositories:

```bash
# Single repo
oracle-mcp "authentication flow" --repo github.com/org/repo
```

### Web Research with Perplexity

Use `-a web` for external APIs, best practices, current standards:

```bash
oracle-mcp -a web "OpenFoodFacts API rate limiting best practices"
oracle-mcp -a web "USDA FoodData Central API authentication 2025"
```

Oracle is configured in `.mcp.json` and can also run as MCP server via `oracle-mcp --mcp`.
