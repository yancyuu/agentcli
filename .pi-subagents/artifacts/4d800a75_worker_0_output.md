# 致命问题走查报告

走查范围：子进程生命周期、启动/关停/信号、并发竞态、未处理异步失败、资源泄漏、外部输入边界、数据一致性、跨平台差异。
重点检查区域：`bin/hermit.mjs`、`src/main/utils/childProcess.ts`、`src/main/server.ts`（生命周期/SSE/定时器）、`DirectCliSessionManager`、`ImLiveWatcher`、`CollaborationBoardService`、`TeamWorkspaceService`、`HermitBridgeConnection`、`BuiltinWorkflowSeeder`、`workerSingleton`、`update.mjs`。

已排除本轮已修复项。

---

## 🔴 CRITICAL

### C1. ImLiveWatcher `fs.watch()` 缺 `.on('error')` → 运行时文件系统错误崩溃整个 server

- **位置**：`src/main/services/session-intelligence/ImLiveWatcher.ts:100`
- **问题**：`this.fsWatcher = watch(this.sessionsDir, callback)` 创建了原生 `fs.FSWatcher`（EventEmitter），但**没有注册 `.on('error')` 监听器**。try/catch 只能捕获 `watch()` 同步抛出的异常，无法捕获运行时异步发出的 `'error'` 事件。
- **触发条件**：
  - Linux 下 inotify watch 数达到系统上限（`ENOSPC`，常见默认 8192 个 watcher）；
  - 被监控目录 `~/.hermit/hermit-bridge/data/sessions` 被删除/重命名（hermit-bridge 重启时会重建该目录）；
  - 文件系统权限变更 / 网络文件系统抖动。
- **影响**：EventEmitter 在没有 `'error'` 监听器时发出 `'error'` 事件，Node.js 将其视为 **uncaughtException**。全项目**没有任何 `process.on('uncaughtException')` 兜底**（已验证），因此整个 Fastify server 进程直接崩溃。所有已连接的 Web UI、SSE、团队会话全部中断。
- **对比**：同项目的 `SkillsWatcherService.ts:92` 用 chokidar 并正确注册了 `.on('error', ...)`；唯独 `ImLiveWatcher` 用原生 `fs.watch` 漏了。
- **建议修法**：在 `attachFsWatch()` 里创建 watcher 后立即加 `this.fsWatcher.on('error', (err) => { if (!isIgnorableFsError(err)) console.error(...); this.fsWatcher = null; })`，让 watchdog interval 自愈重新 attach。一行级修复。

---

## 🟠 HIGH

### H1. server 关停无超时保护 → SIGTERM/SIGINT 被无限挂起

- **位置**：`src/main/server.ts:7761`（`shutdown` 函数）
- **问题**：`await app.close()` **没有 deadline**。如果有活跃的 SSE 连接（`/api/events`、`/mcp`、`/api/update/apply`）或 hermit-bridge WebSocket 不肯关闭，`app.close()` 会永远挂起，`process.exit(0)` 永远不执行。
- **触发条件**：用户按 Ctrl+C 或系统发 SIGTERM 时，恰好有浏览器/飞书机器人保持 SSE 长连接。
- **影响**：进程收到信号后"假死"——不退出也不响应，必须靠外部 `kill -9` 强杀。强杀时 `process.on('exit')` 不保证执行，`directCliManager.shutdown()` 可能来不及 reap claude 子进程 → 孤儿进程残留。
- **对比**：`bin/hermit.mjs:867` 的 daemon shutdown 有 2s force-kill 超时（`setTimeout(..., 2000).unref()`），但 `server.ts` 的 shutdown 没有对标的保护。
- **建议修法**：给 `app.close()` 套一个 `Promise.race([app.close(), timeout(3000)])`，超时后直接 `process.exit()`。

### H2. Windows 下 `which` 未做平台分支（4 处）→ 非 claudecode agent 永远报"未安装"

- **位置**：
  - `src/main/server.ts:5445` — `execFileSync('which', [agentType])` 切 agent 类型
  - `src/main/services/extensions/runtime/CodexAdapter.ts:30` — `execFile('which', [binaryName])`
  - `src/main/services/extensions/runtime/OpenCodeAdapter.ts:29` — 同上
  - `src/main/services/extensions/runtime/GeminiAdapter.ts:29` — 同上
- **问题**：`which` 在 Windows 上不存在（应为 `where`），直接 ENOENT。4 处都没做 `process.platform` 判断。
- **影响**：Windows 用户切换到 codex / opencode / gemini 运行时永远收到"未安装"错误，即使已安装。这不崩溃 server 但完全阻断功能。
- **对比**：代码库已有正确写法 —— `larkCredentials.ts:429`、`larkCli.mjs:22`、`feishuAssistant.mjs:55` 都用 `process.platform === 'win32' ? 'where' : 'which'`。这 4 处遗漏了。
- **建议修法**：统一用已有的 `process.platform === 'win32' ? 'where' : 'which'`。

### H3. `writeJson` 同进程并发写竞态 → 丢数据

- **位置**：`src/main/services/team-management/TeamWorkspaceService.ts:201`
- **问题**：`const tmp = \`${p}.${process.pid}.tmp\`` —— tmp 文件名只用 `process.pid`，同进程内两个并发的 `writeBoard(teamName, ...)` 调用共用**同一个 tmp 路径**。第二个 `writeFile(tmp)` 会覆盖第一个的内容，随后的 `rename` 只保留最后写入方的数据，前一次的 board 修改**静默丢失**。
- **触发条件**：两个 HTTP 请求几乎同时对同一团队的任务看板做写操作（如并发 `transition` + `patchTask`）。
- **影响**：任务状态/消息丢失，用户看到的状态与实际不符。
- **对比**：项目已有 `atomicWriteAsync`（`src/main/utils/atomicWrite.ts`）用 `randomUUID` 做 tmp 后缀，完全避免此竞态。`writeJson` 没用它。
- **建议修法**：tmp 路径加随机后缀（`crypto.randomUUID()`），或直接改用 `atomicWriteAsync`。

### H4. `DirectCliSessionManager.kill()` 用 `child.kill()` 而非 `killProcessTree()` → Windows 孤儿进程

- **位置**：`src/main/services/direct-cli/DirectCliSessionManager.ts:540`
- **问题**：`handle.child.kill('SIGTERM')` 只给直接子进程发信号。如果该子进程是通过 `spawnCli` 的 Windows shell fallback（`shell: true`）启动的，`child.kill()` 只杀了中间的 `cmd.exe` 外壳，**真正的 claude 进程成为孤儿**继续运行。
- **触发条件**：Windows + claude 二进制路径含非 ASCII 字符（触发 `needsShell` → `spawn(cmd, { shell: true })`）。
- **影响**：停止团队/重启 server 后，旧 claude 进程仍在后台运行，占用 session、消耗 token 额度，且无法被后续 kill 命中（session 已从 Map 删除）。
- **对比**：同文件 `childProcess.ts` 已有 `killProcessTree()`（用 `taskkill /T /F` 递归杀进程树），`execCli` 的 timeout 路径正确使用了它。但 `DirectCliSessionManager.kill()` 没用。
- **建议修法**：`kill()` 改为 `killProcessTree(handle.child, 'SIGTERM')`。

---

## ✅ 重点检查过、未发现致命问题的区域（查证到位）

| 区域 | 检查结果 |
|---|---|
| `childProcess.ts` 子进程跟踪 / 超时杀树 | ✅ 完善：`trackCliProcess` + `activeCliProcesses` Set + `killProcessTree`（POSIX 递归 `ps` + Windows `taskkill /T`） |
| `workerSingleton.ts` telemetry worker 单例 | ✅ 完善：启动时 reap 其他 worker（SIGTERM → 200ms grace → SIGKILL），pidfile stale 自愈 |
| `bin/hermit.mjs` daemon 关停 | ✅ 完善：`shutdown()` 有 2s SIGKILL force-timeout，启动时 reap PPID=1 孤儿子进程 |
| `HermitBridgeConnection` WebSocket | ✅ 完善：`.on('error')` / `.on('close')` / 重连退避 / ping interval / dispose 清理 |
| SSE keep-alive intervals | ✅ 完善：`request.raw.on('close')` 清理 `clearInterval` + `sseClients.delete` |
| `ensureGlobalWorkflows` 启动 | ✅ 安全：内部 try/catch + `.catch()`，不崩 startup |
| `initializeTaskBusFromSettings` 启动 | ✅ 安全：Redis 连接失败 try/catch → 降级禁用 task bus |
| `CollaborationBoardService.transition()` 状态机 | ✅ 安全：同步方法，expected-status 校验 + 非法迁移抛错 |
| `execCli` 命令注入 | ✅ 安全：使用 `execFile`（不经过 shell），Windows fallback 的 `quoteArg` 只处理已知 binaryPath+args |
| `update.mjs` 自更新 | ✅ 安全：git checkout tag + npm install 有 try/catch；npm 版本走 `npm install -g` |
| `DirectCliSessionManager.send/respondPermission` stdin 写入 | ✅ 安全：写前检查 `handle.closed || stdin.destroyed` |
| ReDoS | ✅ 未发现：正则均为锚定/有界模式，无嵌套量词 |

---

## 汇总

| 严重度 | 编号 | 问题 | 一句话修法 |
|---|---|---|---|
| 🔴 CRITICAL | C1 | ImLiveWatcher `fs.watch` 缺 error handler → 崩 server | 加 `.on('error')` |
| 🟠 HIGH | H1 | shutdown `app.close()` 无超时 → 信号挂起 | 套 `Promise.race` + timeout |
| 🟠 HIGH | H2 | `which` 在 Windows（4 处）→ 功能阻断 | `win32 ? 'where' : 'which'` |
| 🟠 HIGH | H3 | `writeJson` 并发 tmp 竞态 → 丢数据 | tmp 加 `randomUUID` |
| 🟠 HIGH | H4 | `DirectCliManager.kill` 不杀进程树 → 孤儿 | 改用 `killProcessTree` |

**最高优先级**：C1（一个未注册的 error 事件就能把整个 server 打死，且触发条件常见——Linux inotify 上限、hermit-bridge 重建 sessions 目录）。