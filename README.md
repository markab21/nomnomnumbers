# NomNom Numbers

AI-powered nutrition and calorie tracking MCP server. Search foods, log meals, track macros, and set goals through natural language.

## Features

- Semantic food search with vector embeddings
- Barcode lookup via USDA FoodData Central
- Meal logging with full nutrition data (35 nutrient fields)
- Daily summaries and meal history
- Goal setting and tracking
- Conversation audit logging

## Quick Start

### Docker (Recommended)

```bash
# Pull from GitHub Container Registry
docker pull ghcr.io/markab21/nomnomnumbers:latest

# Run with environment variables
docker run -d \
  --name nomnomnumbers \
  -p 3456:3456 \
  -v nomnomnumbers-data:/app/data \
  -e XAI_API_KEY=your-key \
  -e OPENAI_API_KEY=your-key \
  -e USDA_FDC_API_KEY=your-key \
  ghcr.io/markab21/nomnomnumbers:latest
```

### Local Development

```bash
# Install dependencies
bun install

# Start MCP server (stdio mode)
bun run start

# Start HTTP server
bun run start:http

# Development with watch
bun run dev:http
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `XAI_API_KEY` | Yes | xAI/Grok API key for agent reasoning |
| `OPENAI_API_KEY` | Yes | OpenAI API key for embeddings |
| `USDA_FDC_API_KEY` | Yes | USDA FoodData Central API key |
| `MCP_PORT` | No | HTTP server port (default: 3456) |
| `MCP_HTTP` | No | Set to `true` for HTTP mode |

Get your USDA API key at [fdc.nal.usda.gov](https://fdc.nal.usda.gov/api-key-signup.html)

## Docker Usage

### Volume Mounting

The LanceDB database is stored in `/app/data`. Mount a volume to persist data:

```bash
# Named volume (recommended)
docker run -v nomnomnumbers-data:/app/data ...

# Bind mount to host directory
docker run -v /path/to/data:/app/data ...
```

### Multi-Platform Support

The image supports both `linux/amd64` and `linux/arm64` architectures.

### Docker Compose

```yaml
version: '3.8'
services:
  nomnomnumbers:
    image: ghcr.io/markab21/nomnomnumbers:latest
    ports:
      - "3456:3456"
    volumes:
      - nomnomnumbers-data:/app/data
    environment:
      - XAI_API_KEY=${XAI_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - USDA_FDC_API_KEY=${USDA_FDC_API_KEY}
    restart: unless-stopped

volumes:
  nomnomnumbers-data:
```

## MCP Transports

The server supports multiple transport modes:

### Streamable HTTP (OpenWebUI Compatible)

```
http://localhost:3456/mcp
```

Use this endpoint with OpenWebUI and other clients supporting the MCP Streamable HTTP transport (protocol version 2025-03-26).

### SSE (Server-Sent Events)

```
http://localhost:3456/sse
http://localhost:3456/message
```

Legacy SSE transport for Claude Desktop and other SSE-compatible clients.

### Stdio

Default mode when `MCP_HTTP` is not set. Used for local MCP integrations.

## Client Configuration

### Claude Desktop / Claude Code (stdio)

Add to your MCP settings:

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

### Claude Code (SSE - remote)

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

### OpenWebUI (Streamable HTTP)

In OpenWebUI settings, add MCP server:
- URL: `http://localhost:3456/mcp`
- Type: Streamable HTTP

## Available Tools

| Tool | Description |
|------|-------------|
| `searchFood` | Semantic search for foods |
| `lookupBarcode` | Find food by barcode |
| `logMeal` | Record a meal entry |
| `getDailySummary` | Today's calorie/macro totals |
| `getMealHistory` | Past meal entries |
| `searchMeals` | Semantic search past meals |
| `setGoals` | Set calorie/macro targets |
| `getGoals` | Get user's targets |
| `logInteraction` | Audit trail logging |
| `searchAuditLog` | Search conversation history |
| `getInstructions` | Get usage instructions |

## Health Check

```bash
curl http://localhost:3456/health
```

Returns:
```json
{
  "name": "nomnomnumbers",
  "version": "1.0.0",
  "status": "ok",
  "transports": {
    "streamableHttp": "/mcp",
    "sse": "/sse"
  }
}
```

## License

MIT
