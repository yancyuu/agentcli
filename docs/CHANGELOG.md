# Changelog

本文件记录 openHermit 的用户可见变化。项目遵循 Semantic Versioning。

## [Unreleased]

### Changed

- 重写 README 与公开站点为「开源 + 企业版」双产品说明书：AgentCli 开源免费（AGPL-3.0），AgentBus 定位为付费企业增值服务；合并首页与使用指南为单页，补齐 token 池认领（直写 Claude/Codex 配置）与用量上报三要素说明。
- 将公开文档更新为当前 openHermit 产品面：Fastify API、Vite Web UI、默认 `/teams` 工作台、`~/.hermit/` 本地优先存储，以及 `@yancyyu/agentcli` v1.8.8 包事实。
- 统一 README、文档索引、团队架构、跨团队协作和发布指南中的 Loop Engineering 叙述。
- 明确 cc-connect Bridge 边界：Hermit 负责团队路由、渠道绑定、白名单和审计；平台 Bot 适配由 cc-connect 承载。
- 明确团队工作区由 team、task、message 和 project workspace 组成，并记录 worktree 隔离是当前并行协作能力。
- 明确跨团队协作当前是 Redis-backed dispatch，完整 offer / bid / lease / event Task Bus 是目标模型。
- 更新 Feature Architecture Standard，使新功能默认面向 Fastify/Vite/Web 工作台，而不是 Electron 桌面假设。
- 更新 Release Guide，聚焦 npm CLI package、GitHub Release，以及当前 Docker/GHCR workflow 对 `docker/Dockerfile` 的前置要求。

### Added

- 新增 `docs/README.md` 文档索引，集中列出当前产品事实、主要文档和写作边界。

### Removed

- 从当前能力文档中移除 Electron 桌面打包和内嵌 PTY 终端表述；这些只作为历史说明保留。

## [1.0.0] - 2026-03-19

Initial public release.

### Added

- `general.autoExpandAIGroups` setting: automatically expands all AI response groups when opening a transcript or when new AI responses arrive in a live session. Defaults to off. Stored in the on-disk config so it persists across restarts.
- Strict IPC input validation guards for project/session/subagent/search limits.
- `get-waterfall-data` IPC endpoint implementation.
- Cross-platform path normalization in renderer path resolvers.
- `onTodoChange` preload API event bridge.
- CI workflow for macOS/Windows (typecheck, lint, test, build).
- Release workflow for signed package builds.
- Open-source governance docs (`LICENSE`, `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY`).
- Capped NDJSON diagnostic log for Claude CLI auth/status in packaged builds (Electron logs directory).

### Changed

- `readMentionedFile` preload API signature now requires `projectRoot`.
- Notification update event contract standardized to `{ total, unreadCount }`.
- Session pagination uses cached displayable-content detection for performance.
- File watcher error detection optimized for append-only updates.
- CLI status gathering uses interactive shell environment, merged PATH, and config directory hints aligned with terminal sessions.
- Claude binary resolution deduplicates concurrent resolve calls and uses consistent HOME when probing install locations.

### Fixed

- Lint violations in navigation and markdown/subagent UI components.
- Test mock drift causing runtime errors in test output.
- Multiple Windows path handling edge cases.
- Packaged builds could show "not logged in" despite a working CLI in the shell.
- IPC CLI installer cache clears when `getStatus` fails so the UI does not stay on stale auth state.
