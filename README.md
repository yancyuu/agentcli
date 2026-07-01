<p align="center">
  <img src="resources/icons/png/1024x1024.png" alt="AgentCli" width="96" />
</p>

<h1 align="center">AgentCli</h1>

<p align="center">
  <strong>本地优先的 AI 数字员工团队管理平台</strong><br/>
  创建数字员工团队，分配任务，协调多种 AI Agent 运行时，对接 IM 平台，统一管理工作流程和执行审计。<br/>
  <sub>Local-first AI workforce management — teams, tasks, runtimes, IM routing, and audit trails.</sub>
</p>

<p align="center">
  <a href="https://github.com/yancyuu/Hermit/stargazers"><img src="https://img.shields.io/github/stars/yancyuu/Hermit?style=flat-square&color=brightgreen" alt="GitHub stars" /></a>
  <a href="https://github.com/yancyuu/Hermit/releases/latest"><img src="https://img.shields.io/github/v/release/yancyuu/Hermit?style=flat-square&label=release&color=brightgreen" alt="Latest release" /></a>
  <a href="https://www.npmjs.com/package/@yancyyu/openhermit"><img src="https://img.shields.io/npm/v/@yancyyu/openhermit?style=flat-square&color=brightgreen" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@yancyyu/openhermit"><img src="https://img.shields.io/npm/dm/@yancyyu/openhermit?style=flat-square&color=brightgreen" alt="npm downloads" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-brightgreen?style=flat-square" alt="AGPL-3.0 license" /></a>
</p>

<p align="center">
  <img src="docs/screenshots/openhermit/team-detail.png" alt="AgentCli team workspace" width="100%" />
</p>

---

## 这是什么

AgentCli 是一个本地优先的 **AI 数字员工团队管理平台**。它让你像管理真实团队一样管理 AI Agent：组建团队、分配任务、追踪进度、审核交付——同时打通 IM 协作和多运行时协调。

### 解决的问题

- AI Agent 越来越多，但**谁在做什么、进展如何**没有统一视图
- 多种运行时（Claude Code、Codex、Cursor…）各自独立，**无法协调管理**
- IM 中的 Bot 只能聊天，**无法形成可追踪的任务闭环**
- 团队 AI 使用缺乏**可见性和审计能力**

---

## 30 秒快速体验

```bash
npx @yancyyu/openhermit@latest
```

打开 [http://127.0.0.1:5680](http://127.0.0.1:5680)，创建你的第一个数字员工团队。

```bash
# 或全局安装
npm install -g @yancyyu/openhermit@latest
openhermit
```

---

## 核心能力

### 数字员工团队管理

创建数字员工团队，配置成员、角色、项目目录和运行时。每个团队拥有独立的工作区，包含任务、消息、配置和审计轨迹。

### 任务看板与工作流

看板式任务管理：创建任务、分配 Agent、追踪状态、评论协作、审核交付。支持跨团队任务派发和结构化的交付/审核流程。

### 多运行时协调

统一管理本地安装的多种 AI Agent 运行时。无需切换工具，在一个面板中启动、监控、配置所有 Agent。

### IM 平台对接

通过 hermit-bridge 将飞书、微信、Telegram、Discord、Slack 等 IM 消息路由到数字员工团队。支持群聊触发任务、thread 隔离会话、@ 机器人交互。

### 用量采集与上报

自动扫描本地 AI Agent 会话日志，识别 token 消耗、会话数、消息量。数据可上报至 AgentBus，按团队/成员/工具维度展示企业级用量看板。

### 本地优先架构

所有数据默认存储在本地 `~/.hermit/`。不依赖云端即可完整运行；需要团队协同时可选择接入 AgentBus。

---

## 支持的 AI 运行时

| 一等适配 | 兼容注册 |
|:---|:---|
| Claude Code, Codex, Gemini CLI, Cursor, OpenCode | Devin, Qoder, Kimi, iFlow, ACP, tmux |

---

## 三个组件：CLI · Web · Bus

AgentCli 由三个各司其职的组件组成，默认全部跑在本机、数据落在 `~/.hermit/`。不注册、不连云也能完整使用；接入 Bus 才解锁团队协作和企业看板。

| 组件 | 是什么 | 怎么启动 | 什么时候用 |
|:--|:--|:--|:--|
| **CLI** (`openhermit`) | 终端控制面。交互式导航菜单 + 全部子命令（账号 / 用量 / 团队 / 服务 / 插件）。 | `openhermit` 进菜单，或直接 `openhermit <command>` | 脚本化、SSH/无 GUI、查状态、配自动化上报 |
| **Web 工作台** | 本地浏览器面板（默认 [http://127.0.0.1:5680](http://127.0.0.1:5680)）。可视化的团队、看板、运行时、用量管理。 | `openhermit web` / `openhermit --daemon`，或菜单选「工作台」 | 日常可视化操作、看板拖拽、代码评审、配置调整 |
| **Bus（团队总线）** | 协调骨干：团队元数据、IM→团队消息路由、任务池、跨团队派发、审计、用量收敛。分两层——**本地总线**（本地/自托管 Redis，纯本地协作）和**云端 AgentBus**（可选云后端，收用量/对话上报、出企业看板）。 | 本地：`openhermit collaboration start` 或 Web「设置 → 团队总线」；云端：`openhermit auth login` | 需要多人/多团队协作、IM 触发任务、企业用量看板时 |

> 关系：**CLI 和 Web 都是 Bus 的操作面**——CLI 适合命令行与自动化，Web 适合可视化；两者读写同一份本地数据。不接 Bus = 单机模式，照样能跑。

### CLI（终端，最常用）

```bash
openhermit                       # 交互菜单（推荐起点）
openhermit status                # 后台服务状态
openhermit doctor                # 只读本地诊断
openhermit auth login            # 登录云端 AgentBus（上报前提之一）
openhermit auth status           # 查看登录状态
openhermit usage start           # 开后台用量采集（本机 JSONL，默认开机自启）
openhermit usage stop            # 停后台采集
openhermit usage status          # 本地 telemetry 状态（不上传）
openhermit usage report          # 扫描并按服务端游标增量上报
openhermit usage report --full   # 全量重扫重传（补报历史；服务端按 eventId 去重）
openhermit teams list            # 查看本地团队
openhermit teams create          # 创建团队
openhermit tasks list --team <t> # 查看某团队活跃任务
openhermit collaboration start   # 启用本地/自托管团队总线
openhermit services start web|usage|collaboration|local   # 按项启动服务
openhermit stop                  # 停后台服务
openhermit update                # 自更新
openhermit add <plugin>          # 装能力插件到 MCP library
```

### Web 工作台

```bash
openhermit web            # 启动并打开浏览器工作台（默认 5680 端口）
openhermit --daemon       # 后台运行（关掉终端不停）
openhermit --port 8080    # 换端口
```

打开后：创建团队 → 配置数字员工与运行时 → 看板派活 → 评审交付 → 看用量看板。

### Bus（团队总线）

```bash
openhermit collaboration start   # 启用本地总线（Redis；纯本地协作）
openhermit auth login            # 接入云端 AgentBus（开启上报 + 企业看板）
# 也可在 Web：设置 → 团队总线，可视化配置
```

### 给 CC 的引导：开启自动上报的最小步骤

自动上报需要**三要素同时满足**——登录 + 消息上报开关 + 后台采集：

```bash
openhermit auth login            # 1. 登录云端 AgentBus（拿 Bearer token）
# 2. 在菜单「用量同步」里打开「消息上报」（无子命令，只能菜单/Web 切换）
openhermit usage start           # 3. 开后台采集（默认开机自启，每 5 分钟增量上报）
openhermit usage report          # 4. 立即扫描并上报一次（可选，验证链路）
openhermit status                # 5. 核对状态 / Web 用量看板查收
```

> 注意：步骤 2 没有对应子命令，是刻意设计——消息上报开关只在交互菜单或 Web 里切。CLI 只负责登录和后台采集。详见 [使用指南](https://yancyuu.github.io/Hermit/guide.html)。

---

## 截图

<details>
<summary>展开查看更多截图</summary>

<table>
  <tr>
    <td align="center"><b>团队列表</b></td>
    <td align="center"><b>团队工作区</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/openhermit/team-list.png" alt="Team list" width="480" /></td>
    <td><img src="docs/screenshots/openhermit/team-detail.png" alt="Team detail" width="480" /></td>
  </tr>
  <tr>
    <td align="center"><b>任务看板</b></td>
    <td align="center"><b>运行时设置</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/openhermit/tasks.png" alt="Task board" width="480" /></td>
    <td><img src="docs/screenshots/openhermit/settings.png" alt="Settings" width="480" /></td>
  </tr>
</table>

</details>

---

## 文档

- [使用指南](https://yancyuu.github.io/Hermit/guide.html)
- [Issues / 反馈](https://github.com/yancyuu/Hermit/issues)
- [Changelog](docs/CHANGELOG.md)

---

## License

[AGPL-3.0](LICENSE)
