# =============================================================================
# Hermit standalone Docker image
#
# Includes Claude Code CLI so agents can operate on mounted project code.
#
# Build:  docker build -t hermit .
# Run:    docker run -p 4567:4567 \
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

# Trim node_modules to production deps only for the runtime stage
RUN CI=true pnpm prune --prod --ignore-scripts || true
# protobufjs/minimal is externalized but may be pruned; re-hoist from pnpm store
RUN if [ -d node_modules/.pnpm ]; then \
      cp -r node_modules/.pnpm/protobufjs@*/node_modules/protobufjs node_modules/protobufjs 2>/dev/null || true; \
      for pkg in @protobufjs/aspromise @protobufjs/base64 @protobufjs/codegen @protobufjs/eventemitter @protobufjs/fetch @protobufjs/float @protobufjs/inquire @protobufjs/path @protobufjs/pool @protobufjs/utf8; do \
        src=$(find node_modules/.pnpm -path "*/$pkg/package.json" -maxdepth 5 2>/dev/null | head -1); \
        if [ -n "$src" ]; then mkdir -p "node_modules/$pkg" && cp -r "$(dirname "$src")/." "node_modules/$pkg/"; fi; \
      done; \
    fi

# =============================================================================
# Production stage
# =============================================================================
FROM node:20-slim

WORKDIR /app

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Copy production node_modules from builder (already pruned)
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/agent-teams-controller ./agent-teams-controller

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
