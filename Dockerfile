# syntax=docker/dockerfile:1

FROM oven/bun:1.3.4-slim AS base
WORKDIR /app

# Install dependencies only when needed
FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Production image
FROM base AS runner
ENV NODE_ENV=production
ENV MCP_HTTP=true
ENV MCP_PORT=3456

# Install curl for health check
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules

# Copy source files
COPY package.json ./
COPY src ./src
COPY tsconfig.json ./

# Create data directory for LanceDB
RUN mkdir -p /app/data

# Expose the HTTP port
EXPOSE 3456

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3456/sse || exit 1

# Run the MCP server in HTTP mode
CMD ["bun", "run", "src/index.ts"]
