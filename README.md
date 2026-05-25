<p align="center">
  <img src="resources/icons/png/1024x1024.png" alt="openHermit" width="100" />
</p>

<h1 align="center">openHermit</h1>

<p align="center">
  <strong>给一人公司和小团队用的本地 AI Agent 控制台</strong><br/>
  把 Claude Code、Codex、Gemini、Qoder 等 Agent 放进同一个看板、消息和审查流程里。
</p>

<p align="center">
  <a href="https://github.com/yancyuu/Hermit/releases/latest"><img src="https://img.shields.io/github/v/release/yancyuu/Hermit?style=flat-square&label=version&color=blue" alt="最新版本" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="许可证" /></a>
</p>

---

## openHermit 是什么

openHermit 是一个本地运行的 AI Agent 工作台。它适合一人公司、小团队，以及每天同时使用多个 AI Coding Agent 的开发者。

你可以把它理解成一个组织，不同的团队有不同的工作空间（文件即记忆），不同团队可以相互通信。

它不提供模型，也不托管你的代码。openHermit 会在本机启动和管理 Claude Code、Codex、Gemini、Qoder 等运行时，项目代码、任务数据和配置默认都留在本机。

## 为什么需要它

AI Coding Agent 正在从“单次对话工具”变成“长期协作成员”。当你希望一个人同时管理产品、UI、后端、测试、运营等多个 AI 团队时，问题不再只是多开几个终端，而是缺少一套协作结构：

- **团队需要边界**：不同团队应该有自己的工作空间、运行时、渠道和上下文，而不是全部混在一个聊天窗口里。
- **任务需要流转**：产品需求要能拆成任务，派给 UI、后端、测试等团队，并在任务列表里留下状态和结果。
- **消息需要归属**：来自飞书、微信、Telegram 或 Web 控制台的消息，需要进入正确团队，而不是散在不同入口。
- **执行需要可追踪**：Agent 的会话、日志、错误和输出应该能回看，方便判断它到底做了什么。
- **交付需要审查**：Agent 可以改代码，但代码变更仍然需要进入审查流程，避免直接混进项目。
- **经验需要复用**：团队模板、Skills、运行时配置和项目约定应该能沉淀下来，下次创建团队时继续使用。

openHermit 的目标是把这些东西放到一个本地控制台里：团队负责边界，任务负责流转，消息负责沟通，审查负责交付，日志负责复盘。

---

## 界面预览

### 团队工作台

团队详情页把成员、任务待开发、消息和会话放在同一个视图里。你可以直接给团队发送需求，也可以查看 Agent 的回复和运行会话。

![团队工作台](docs/screenshots/openhermit/team-detail.png)

### Harness 配置

openHermit 在同一处管理不同 Agent 运行时。Claude Code、Codex、Cursor、Gemini、Qoder 等运行时可以统一查看和配置。

![Harness 配置](docs/screenshots/openhermit/harness-settings.png)

### 团队列表

团队列表展示当前所有团队、绑定项目和运行状态，适合在多个项目或多个 Agent 团队之间切换。

![团队列表](docs/screenshots/openhermit/team-list.png)

### 渠道绑定

绑定飞书、微信、Telegram、Discord、Slack、钉钉、企业微信、QQ、LINE 等渠道，让外部消息进入对应团队。

![渠道绑定](docs/screenshots/openhermit/channel-binding.png)

---

## 你可以用它做什么

- **创建 AI 团队**：为前端、后端、测试、调研等工作创建不同团队或角色。
- **用看板管任务**：任务有状态、负责人、执行记录和结果，不再散在聊天里。
- **给 Agent 发消息**：向负责人或具体成员补充指令，保留上下文。
- **团队派单（规划中）**：产品团队可以把任务派给 UI、后端、测试等团队，任务进入对方任务列表并由对应渠道执行。
- **审查代码改动**：Agent 产生的变更进入审查流程，而不是直接混进代码库。
- **查看运行状态**：会话、日志、错误和启动状态集中展示，便于排障。
- **接入外部渠道**：接入飞书、微信、Telegram 等消息来源。
- **复用团队配置**：把团队模板、Skills 和工作方式沉淀下来，下次直接复用。

---

## 支持的 Agent 运行时

openHermit 支持多种 Agent 运行时。当前常用类型包括：

| Harness | 标识 | MCP 自动注入 | 适合场景 |
|---|---|---|---|
| **Claude Code** | `claudecode` | ✅ 自动 | 默认推荐的编码运行时 |
| **Qoder** | `qoder` | ✅ 自动 | Claude Code 兼容运行时 |
| **Codex** | `codex` | 手动配置 | OpenAI/Codex 生态 |
| **Gemini** | `gemini` | 手动配置 | Google/Gemini 生态 |
| **OpenCode** | `opencode` | 手动配置 | 多 provider 开源运行时 |
| **Cursor** | `cursor` | 手动配置 | Cursor 相关运行时 |
| **Kimi** | `kimi` | 手动配置 | 长文本和文档任务 |

实际可用能力取决于本机安装的 CLI、账号状态和对应运行时的支持情况。

---

## 支持的消息渠道

同一个团队可以绑定一个或多个消息渠道：

| 渠道 | 场景 |
|---|---|
| **飞书** | 企业级，支持消息卡片 |
| **微信** | 个人/小团队最顺手 |
| **Telegram** | 海外 / 技术向首选 |
| **内部 Bridge** | openHermit 内部和自定义集成 |

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

后续的团队派单会把这种协作做成更明确的产品流程：例如产品团队把需求派给 UI 团队，选择目标渠道后，任务会进入 UI 团队的任务列表，由该团队的 Agent 接收并执行。

### 3. 定时任务

可以配置定时任务，例如日报、代码健康检查、数据拉取等。

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
       本地运行时服务
    （渠道接入 + Agent 进程管理）
              ↓
           openHermit
    （团队管理 + 任务路由 + 看板 UI）
              ↓
      MCP Server（hermit-tasks）
              ↓
  Claude Code / Codex / Gemini / Qoder / ...
```

openHermit 及其本地运行时服务都运行在本机。项目代码、任务数据和配置默认存放在本地。

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
openhermit --daemon        # 后台运行
openhermit status          # 查看后台运行状态
openhermit stop            # 停止后台服务
openhermit --port 8080     # 指定 Web 控制台端口
openhermit --version       # 查看版本
openhermit update          # 更新 openHermit
```

首次启动会自动创建本地运行时配置，并生成本地 token。通常只需要打开 `http://127.0.0.1:5680` 使用 openHermit。

### 本地开发

```bash
git clone https://github.com/yancyuu/hermit.git
cd hermit
pnpm install
pnpm dev
```

浏览器打开 `http://localhost:5174`

开发模式默认连接本机运行时服务；生产 CLI 会优先使用 openHermit 管理的本地配置。

### 创建第一个 AI 团队

1. 点击「新建团队」
2. 填写团队名、选 harness（如 `claudecode`）
3. 选择对应的本地项目和运行时
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
- **通信**：本地 Bridge WebSocket + Management HTTP API
- **协议**：MCP over HTTP（SSE + JSON-RPC）

---

## 许可证

[AGPL-3.0](LICENSE)
