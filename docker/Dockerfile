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

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/* || \
    (apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*)

# Enable corepack for pnpm
RUN corepack enable

# Install dependencies first (better layer caching)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY agent-teams-controller/package.json ./agent-teams-controller/package.json
# --ignore-scripts skips native addon builds (node-pty needs Electron headers)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build workspace packages that the main app depends on
COPY agent-teams-controller ./agent-teams-controller
RUN pnpm --filter agent-teams-controller build

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

# Copy package files and install production-only dependencies.
# --ignore-scripts skips native addon builds (node-pty, ssh2, etc.) which
# require Electron headers or compilers not available in this slim image.
# The standalone bundle externalizes fastify and agent-teams-controller;
# only those packages need real node_modules at runtime.
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts
# protobufjs is a transitive dep required at runtime by bundled protobuf code
# but not hoisted by pnpm to top-level. Copy it from the builder where it exists.
COPY --from=builder /app/node_modules/.pnpm/protobufjs@*/node_modules/protobufjs ./node_modules/protobufjs

# Copy workspace packages that are externalized from the bundle
COPY --from=builder /app/agent-teams-controller ./agent-teams-controller
# Copy pnpm store links so workspace deps resolve at runtime
COPY --from=builder /app/node_modules ./node_modules

# Copy built standalone server and renderer output
COPY --from=builder /app/dist-standalone ./dist-standalone
COPY --from=builder /app/out/renderer ./out/renderer

# Create data directories
RUN mkdir -p /data/.claude /data/project

ENV NODE_ENV=production
ENV CLAUDE_ROOT=/data/.claude
ENV HOST=0.0.0.0
ENV PORT=4567

EXPOSE 4567

CMD ["node", "dist-standalone/index.cjs"]
