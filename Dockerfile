# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies (including devDependencies needed for tsc)
COPY package*.json ./
RUN npm ci

# Compile TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Run as non-root user
RUN addgroup -S mcpgroup && adduser -S mcpuser -G mcpgroup
USER mcpuser

# HTTP/SSE port (overridable via PORT env var)
EXPOSE 8080

# Start in HTTP mode — stdio mode is not meaningful inside a container
ENV PORT=8080

CMD ["node", "dist/index.js", "--http"]
