# =============================================================================
# Hermit standalone Docker image
#
# Includes Claude Code CLI so agents can operate on mounted project code.
#
# Build:  docker build -t hermit .
# Run:    docker run -p 3456:3456 \
#           -v ~/.claude:/data/.claude \
#           -v ~/my-project:/data/project \
#           hermit
# =============================================================================

FROM node:20-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Enable corepack for pnpm
RUN corepack enable

# Install dependencies first (better layer caching)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm standalone:build

# =============================================================================
# Production stage
# =============================================================================
FROM node:20-slim

WORKDIR /app

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Enable corepack for pnpm (production deps)
RUN corepack enable

# Copy package files and install production-only dependencies
# (fastify, @fastify/cors, @fastify/static are externalized from the bundle)
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Copy built standalone server and renderer output
COPY --from=builder /app/dist-standalone ./dist-standalone
COPY --from=builder /app/out/renderer ./out/renderer

# Create data directories
RUN mkdir -p /data/.claude /data/project

ENV NODE_ENV=production
ENV CLAUDE_ROOT=/data/.claude
ENV HOST=0.0.0.0
ENV PORT=3456

EXPOSE 3456

CMD ["node", "dist-standalone/index.cjs"]
