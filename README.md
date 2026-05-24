<p align="center">
  <img src="resources/icons/png/1024x1024.png" alt="openHermit" width="100" />
</p>

<h1 align="center">openHermit</h1>

<p align="center">
  <strong>一人公司的 AI 团队指挥台</strong><br/>
  你是老板，AI 是员工，openHermit 是你的 ERP。
</p>

<p align="center">
  <a href="https://github.com/yancyuu/Hermit/releases/latest"><img src="https://img.shields.io/github/v/release/yancyuu/Hermit?style=flat-square&label=version&color=blue" alt="最新版本" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="许可证" /></a>
</p>

---

## 你是 OPC / TPC 吗？

**OPC（One-Person Company）/ TPC（Two-Person Company）** — 一两个人做出过去需要整支团队才能完成的产品。

这不是梦想，这正在发生。Claude Code、Codex、Gemini、Cursor、Qoder……这些 AI Coding Agent 已经可以独立完成需求分析、代码实现、测试、部署的完整链路。

**但问题来了：你同时开着 10 个终端，不停地切换窗口、复制粘贴上下文、记住哪个 Agent 在做什么——这还是在"管人"。**

openHermit 解决这个问题。

---

## openHermit 是什么

openHermit 是一个 **AI 团队任务指挥台**，以 cc-connect 为引擎，让你像老板一样管理由 AI 组成的团队：

- **你创建任务，AI 自动认领并执行**，结果写回看板
- **不同 Agent 各司其职**，Claude Code 写代码、Gemini 做调研、Codex 跑测试
- **跨团队协作自动路由**，任务分配给哪个团队，消息立刻推过去
- **定时任务一键调度**，不用盯着
- **飞书/微信/Telegram 渠道统一接入**，随时查看进展、发指令

你做决策，AI 做执行。

---

## 与竞品的核心差异

| | openHermit | 普通 AI IDE 插件 | 自建脚本 |
|---|---|---|---|
| **理念** | AI 员工团队 | 辅助写代码 | 定制化自动化 |
| **Harness 支持** | 几乎全覆盖（见下表） | 单一 | 手写对接 |
| **渠道接入** | 飞书/微信/Telegram/Bridge | ❌ | 手写 |
| **多团队协作** | 任务自动路由 + MCP | ❌ | 手写 |
| **任务追踪** | 看板 + 状态机 | ❌ | ❌ |
| **上手成本** | 创建团队即用 | 低 | 极高 |
| **一人公司适配** | 专为此设计 | 不适合 | 勉强 |

---

## 支持市面上几乎所有 Harness

cc-connect 管理 Agent 运行时，openHermit 通过它驱动以下全部 harness：

| Harness | 标识 | MCP 自动注入 | 适合场景 |
|---|---|---|---|
| **Claude Code** | `claudecode` | ✅ 自动 | 全能型编码，最强上下文 |
| **Qoder** | `qoder` | ✅ 自动 | Claude Code 的增强版 |
| **Codex** | `codex` | 手动配置 | OpenAI 生态，o系列推理 |
| **Gemini** | `gemini` | 手动配置 | Google 生态，长上下文分析 |
| **OpenCode** | `opencode` | 手动配置 | 多 provider 开源方案 |
| **Cursor** | `cursor` | 手动配置 | IDE 深度集成 |
| **Kimi** | `kimi` | 手动配置 | 国产长文档处理 |

**新 harness 不需要改 openHermit 代码** — cc-connect 对接，openHermit 自动列出。

---

## 支持几乎所有渠道

同一个团队可以同时接入多个渠道，你从哪里发消息都能收到回复：

| 渠道 | 场景 |
|---|---|
| **飞书** | 企业级，支持消息卡片 |
| **微信** | 个人/小团队最顺手 |
| **Telegram** | 海外 / 技术向首选 |
| **Bridge** | 跨团队内部通信（openHermit 内置） |

---

## 它帮你做什么

### 1. 任务看板 — 你的 AI 工单系统

```
你：在看板里创建一个任务 "重构支付模块"，assignee → backend-team
    ↓
openHermit：自动推消息给 backend-team 的 Agent
    ↓
Agent：用 MCP 认领任务，开始执行
    ↓
完成后：结果写回看板，状态变 done，你在看板里一眼看到
```

### 2. 多团队 — 分工协作，各尽其能

```
前端团队 (Claude Code)  ——→  你的产品界面
后端团队 (Codex)        ——→  API 和业务逻辑
测试团队 (Gemini)       ——→  自动化测试和 QA
调研团队 (Kimi)         ——→  竞品分析、文档整理
```

每个团队独立运行，任务可以跨团队分配，互不干扰。

### 3. 定时任务 — 你的 AI 会自己上班

在 openHermit 里配置定时计划，Agent 按时执行：早报、日报、代码健康检查、数据拉取……你睡觉，Agent 在跑。

### 4. MCP 零配置接入

Claude Code / Qoder 类 harness 创建团队时自动注入 MCP 配置，Agent 立刻拥有任务工具：

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

openHermit 本身是 **纯本地、无 SaaS、无月费**。cc-connect 跑在你的机器上，数据不出门。

---

## 快速开始

### 一键安装

openHermit 的 npm 包会捆绑安装并自动启动 cc-connect：

```bash
npm install -g @yancyyu/openhermit
openhermit
```

启动后浏览器打开 `http://127.0.0.1:5680`。

也可以使用这些命令：

```bash
open-hermit              # 等同于 openhermit
openhermit --port 8080   # 使用自定义端口
openhermit --version     # 查看版本
openhermit update        # 检查并更新
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
