<p align="center">
  <img src="resources/icons/png/1024x1024.png" alt="openHermit" width="100" />
</p>

<h1 align="center">openHermit</h1>

<p align="center">
  <strong>本地 AI Agent 团队工作台</strong><br/>
  面向一人公司和小团队，用一个 Web 控制台管理 Agent 团队、任务看板、消息和运行状态。
</p>

<p align="center">
  <a href="https://github.com/yancyuu/Hermit/releases/latest"><img src="https://img.shields.io/github/v/release/yancyuu/Hermit?style=flat-square&label=version&color=blue" alt="最新版本" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="许可证" /></a>
</p>

---

## openHermit 是什么

openHermit 是一个本地运行的 AI Agent 工作台，适合一人公司、小团队和高频使用 AI Coding Agent 的个人开发者。它基于 cc-connect 启动和管理 Claude Code、Codex、Gemini、Qoder 等 Agent 运行时，并提供团队、任务、消息和看板 UI。

它主要解决这些问题：

- 一个人同时调度多个 AI Agent 时，很难记住谁在做什么。
- 多个 Agent 运行时分散在不同终端里，不方便跟踪。
- 任务、消息和执行结果缺少统一记录。
- Agent 改代码后需要有明确的审查入口。
- 团队模板、Skills 和项目经验需要复用。

---

## 能力概览

- 为一个人或小团队创建多个 AI Agent 团队。
- 创建团队并选择 Agent 运行时。
- 用看板管理任务状态和结果。
- 通过消息面板向团队或成员发送指令。
- 查看运行日志和会话历史。
- 对 Agent 产生的代码变更进行审查。
- 通过 cc-connect 接入飞书、微信、Telegram 等渠道。
- 使用 MCP 工具让 Agent 认领、更新和完成任务。

---

## 支持的 Agent 运行时

openHermit 通过 cc-connect 管理 Agent 运行时。当前常用类型包括：

| Harness | 标识 | MCP 自动注入 | 适合场景 |
|---|---|---|---|
| **Claude Code** | `claudecode` | ✅ 自动 | 默认推荐的编码运行时 |
| **Qoder** | `qoder` | ✅ 自动 | Claude Code 兼容运行时 |
| **Codex** | `codex` | 手动配置 | OpenAI/Codex 生态 |
| **Gemini** | `gemini` | 手动配置 | Google/Gemini 生态 |
| **OpenCode** | `opencode` | 手动配置 | 多 provider 开源运行时 |
| **Cursor** | `cursor` | 手动配置 | Cursor 相关运行时 |
| **Kimi** | `kimi` | 手动配置 | 长文本和文档任务 |

实际可用能力取决于本机安装的 CLI、账号状态和 cc-connect 的支持情况。

---

## 支持的消息渠道

openHermit 复用 cc-connect 的渠道能力。同一个 cc-connect project 可以绑定一个或多个渠道：

| 渠道 | 场景 |
|---|---|
| **飞书** | 企业级，支持消息卡片 |
| **微信** | 个人/小团队最顺手 |
| **Telegram** | 海外 / 技术向首选 |
| **Bridge** | openHermit 内部和自定义集成 |

---

## 主要流程

### 1. 任务看板

```
用户：在看板里创建任务，例如 "重构支付模块"
    ↓
openHermit：把任务写入团队看板，并通知对应 Agent
    ↓
Agent：用 MCP 认领任务，开始执行
    ↓
完成后：结果写回看板，状态更新
```

### 2. 多团队

```
前端团队 (Claude Code)  ——→  UI 任务
后端团队 (Codex)        ——→  API 和业务逻辑
测试团队 (Gemini)       ——→  测试和验证
调研团队 (Kimi)         ——→  文档和资料整理
```

每个团队有独立配置、任务和消息记录。任务可以分配给不同团队。

### 3. 定时任务

可以通过 cc-connect 配置定时任务，例如日报、代码健康检查、数据拉取等。

### 4. MCP 零配置接入

Claude Code / Qoder 类运行时创建团队时会自动注入 MCP 配置，让 Agent 可以使用任务工具：

```
list_tasks    — 看自己有哪些任务
claim_task    — 认领任务，开始干活
complete_task — 完成任务，写入结果
create_task   — 创建新任务分配给其他团队
```

---

## 架构

```
你的指令 / 飞书消息 / 微信消息 / Telegram
              ↓
         cc-connect
    （渠道接入 + Agent 进程管理）
              ↓
           openHermit
    （团队管理 + 任务路由 + 看板 UI）
              ↓
      MCP Server（hermit-tasks）
              ↓
  Claude Code / Codex / Gemini / Qoder / ...
```

openHermit 和 cc-connect 都运行在本机。项目代码、任务数据和配置默认存放在本地。

---

## 快速开始

### npm 安装

安装 CLI：

```bash
npm install -g @yancyyu/openhermit
openhermit
```

启动后打开：

```text
http://127.0.0.1:5680
```

常用命令：

```bash
open-hermit                # 等同于 openhermit
openhermit --port 8080     # 指定 Web 控制台端口
openhermit --no-cc-connect # 不自动启动 cc-connect
openhermit --version       # 查看版本
openhermit update          # 更新 openHermit
```

首次启动会自动创建 `~/.hermit/cc-connect/config.toml`，启用 cc-connect Management API
（9820）和 Bridge（9810），并生成本地 token。

### 本地开发

```bash
git clone https://github.com/yancyuu/hermit.git
cd hermit
pnpm install
pnpm dev
```

浏览器打开 `http://localhost:5174`

开发模式默认连接本机 cc-connect；生产 CLI 会优先使用 openHermit 管理的
`~/.hermit/cc-connect/config.toml`。

### 创建第一个 AI 团队

1. 点击「新建团队」
2. 填写团队名、选 harness（如 `claudecode`）
3. 选择对应的 cc-connect project
4. 保存 → 看板就绪，任务等你分配

---

## 文件结构

```
~/.hermit/
  └── teams/
        ├── frontend/
        │     ├── team.json        # 团队配置（harness、bindProject、color）
        │     └── tasks/board.json # 任务看板
        └── backend/
              ├── team.json
              └── tasks/board.json
```

所有数据存本地，可以用 Git 备份。

---

## 技术栈

- **前端**：React + TypeScript + Tailwind CSS + Zustand
- **后端**：Fastify（Node.js）
- **存储**：本地文件（`~/.hermit/`）
- **通信**：cc-connect Bridge WebSocket + Management HTTP API
- **协议**：MCP over HTTP（SSE + JSON-RPC）

---

## 许可证

[AGPL-3.0](LICENSE)
