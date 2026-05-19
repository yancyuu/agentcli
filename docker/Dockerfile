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
#
# Note: The CLI requires non-root for --dangerously-skip-permissions.
# Use --user flag when running: docker run --user $(id -u):$(id -g) ...
# Or set UID/GID via environment: UID=501 GID=20 docker compose up
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
COPY mcp-server/package.json ./mcp-server/package.json
# --ignore-scripts for faster install in Docker
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build workspace packages that the main app depends on
COPY agent-teams-controller ./agent-teams-controller
COPY mcp-server ./mcp-server
RUN pnpm --filter agent-teams-controller build
RUN pnpm --filter agent-teams-mcp build

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

# Install git + ca-certificates (needed for template source cloning)
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
# Install Claude Code CLI via npm
RUN npm install -g @anthropic-ai/claude-code

# Copy production node_modules from builder (already pruned)
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/agent-teams-controller ./agent-teams-controller
COPY --from=builder /app/mcp-server ./mcp-server

# Copy built standalone server and renderer output
COPY --from=builder /app/dist-standalone ./dist-standalone
COPY --from=builder /app/out/renderer ./out/renderer

# Create data directories (ownership set at runtime via --user flag in docker-compose)
RUN mkdir -p /data/.claude /data/project /data/.claude/skills
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker/settings.template.json /data/.claude/settings.template.json

ENV NODE_ENV=production
ENV CLAUDE_ROOT=/data/.claude
ENV HOST=0.0.0.0
ENV PORT=4567

EXPOSE 4567

# Run as non-root user (CLI requires non-root for --dangerously-skip-permissions).
# Set via --user flag in docker-compose.yml.
CMD ["/usr/local/bin/entrypoint.sh"]