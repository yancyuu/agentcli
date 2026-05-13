<p align="center">
  <a href="docs/screenshots/1.jpg"><img src="docs/screenshots/1.png" width="75" alt="看板" /></a>&nbsp;
  <a href="docs/screenshots/7.png"><img src="docs/screenshots/7.png" width="75" alt="代码审查" /></a>&nbsp;
  <a href="docs/screenshots/2.png"><img src="docs/screenshots/2.png" width="75" alt="团队视图" /></a>&nbsp;
  <a href="docs/screenshots/8.png"><img src="docs/screenshots/8.png" width="75" alt="任务详情" /></a>&nbsp;
  <img src="resources/icons/png/1024x1024.png" alt="Hermit" width="80" />&nbsp;
  <a href="docs/screenshots/9.png"><img src="docs/screenshots/9.png" width="75" alt="执行日志" /></a>&nbsp;
  <a href="docs/screenshots/3.png"><img src="docs/screenshots/3.png" width="75" alt="智能体评论" /></a>&nbsp;
  <a href="docs/screenshots/4.png"><img src="docs/screenshots/4.png" width="75" alt="创建团队" /></a>&nbsp;
  <a href="docs/screenshots/6.png"><img src="docs/screenshots/6.png" width="65" alt="设置" /></a>
</p>

<h1 align="center">Hermit</h1>

<p align="center">
  <strong>本地优先的 AI Agent 团队工作台</strong><br />
  把 AI 从个人编程助手升级为团队基础设施：模板建队、看板协作、Skills 统一、代码审查和运行诊断都在一个本地控制面里完成。
</p>

<p align="center">
  <a href="https://github.com/yancyuu/Hermit/releases/latest"><img src="https://img.shields.io/github/v/release/yancyuu/Hermit?style=flat-square&label=version&color=blue" alt="最新版本" /></a>&nbsp;
  <a href="https://github.com/yancyuu/Hermit/actions/workflows/ci.yml"><img src="https://github.com/yancyuu/Hermit/actions/workflows/ci.yml/badge.svg" alt="CI 状态" /></a>&nbsp;
  <a href="https://yancyuu.github.io/Hermit/zh"><img src="https://img.shields.io/badge/官网-Hermit-111827?style=flat-square" alt="Hermit 中文官网" /></a>&nbsp;
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="许可证" /></a>
</p>

<p align="center">
  <a href="https://github.com/yancyuu/Hermit/releases/latest/download/Hermit-arm64.dmg"><img src="https://img.shields.io/badge/macOS_Apple_Silicon-DMG-000000?style=for-the-badge&logo=apple&logoColor=white" alt="下载 macOS Apple Silicon DMG" /></a>
  <a href="https://github.com/yancyuu/Hermit/releases/latest/download/Hermit-x64.dmg"><img src="https://img.shields.io/badge/macOS_Intel-DMG-000000?style=for-the-badge&logo=apple&logoColor=white" alt="下载 macOS Intel DMG" /></a>
  <a href="https://github.com/yancyuu/Hermit/releases/latest/download/Hermit-Setup.exe"><img src="https://img.shields.io/badge/Windows-Setup.exe-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="下载 Windows 安装包" /></a>
</p>
<p align="center">
  <a href="https://github.com/yancyuu/Hermit/releases/latest/download/Hermit.AppImage"><img src="https://img.shields.io/badge/Linux-AppImage-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="下载 Linux AppImage" /></a>
  <a href="https://github.com/yancyuu/Hermit/releases/latest/download/Hermit-amd64.deb"><img src="https://img.shields.io/badge/Linux-DEB-A81D33?style=for-the-badge&logo=debian&logoColor=white" alt="下载 Linux DEB" /></a>
  <a href="https://github.com/yancyuu/Hermit/releases/latest/download/Hermit-x86_64.rpm"><img src="https://img.shields.io/badge/Linux-RPM-EE0000?style=for-the-badge&logo=redhat&logoColor=white" alt="下载 Linux RPM" /></a>
</p>

> 如果上面的稳定下载链接暂时不可用，请前往 [Releases](https://github.com/yancyuu/Hermit/releases/latest) 页面选择对应平台资产。

<img width="1304" height="820" alt="Hermit 界面预览" src="docs/screenshots/hero.png" />

## Hermit 是什么

Hermit 是一个面向软件工程团队的 AI Agent 协作工作台。它不是新的模型平台，也不替代 Claude Code；它负责把 Claude Code 等本地编程运行时组织成可管理、可复用、可审查的团队协作流程。

你可以把 Hermit 理解成 AI 研发团队的本地控制面：

- 用团队和角色承载复杂工作，而不是把所有需求塞进一个聊天窗口。
- 用看板追踪任务状态，让需求、执行、审查和讨论都可回溯。
- 用代码审查视图接住 Agent 的改动，避免 AI 产物绕过工程审查。
- 用 Git 仓库同步团队模板和全局 Skills，把个人经验沉淀成团队资产。
- 用运行日志和诊断信息保留 AI 工作过程，方便复盘和排障。

当前主力运行时是官方 Claude Code / `claude` CLI。Codex 作为 beta provider 正在接入和验证中。

## 1.5.2 版本更新

- 支持根据团队模板创建团队，并可通过外部 Git 仓库沉淀和同步团队模板资产。
- 支持对接外部 Skills 仓库，集中管理全局 Skills，避免每个人重复维护、质量不一、难以更新。
- Skills 只管理全局 Skills；项目级能力通过团队角色、任务分工和项目约定来明确职责边界。
- 随着模型侧能力持续内化，Hermit 不会继续做特别细颗粒度的 Skills 管理，也不会把 Skills 管理扩展成独立的大功能模块。
- 定时任务运行日志支持运行中实时刷新，方便确认任务是否已经开始执行。

## 为什么需要它

Claude Code、Cursor 等 AI 编程工具已经进入日常开发，但大多数团队仍停留在“每个人独立使用 AI”的阶段。单人使用很灵活，团队协作时却会暴露出明显问题：

- Skills 散落在个人电脑或项目目录里，同类能力重复建设，无法统一升级。
- 好用的角色配置和工作流只存在于某个人的本地环境里，人员变动后经验容易丢失。
- 所有需求塞进一个聊天窗口，上下文膨胀，Token 成本和回答质量都不可控。
- Agent 直接改代码但缺少统一审查入口，潜在风险难以及时拦截。
- AI 执行过程不可追溯，团队很难评估 AI 真实产出和问题原因。

Hermit 的解法是把 AI 使用方式从“个人工具”升级为“团队基础设施”：负责人拆任务，成员按角色执行，看板承载状态，代码审查控制合入，日志和任务记录负责追溯，模板与 Skills 仓库负责复用。

## 适合什么场景

- 想把 Claude Code 的个人使用经验推广到研发团队。
- 希望统一管理全局 Skills，避免每个人各写一套。
- 希望用团队模板快速复用标准角色、工作流和审查规则。
- 希望 AI 产出进入代码审查，而不是直接落到代码库。
- 希望保留 AI 执行过程，便于排查、复盘和评估投入产出。

## 核心能力

### Agent 团队

创建包含负责人、架构师、实现工程师、测试工程师、审查员等角色的团队。负责人负责理解需求和拆解任务，成员按角色执行具体工作。

团队可以从模板创建，模板可沉淀到外部 Git 仓库，适合在部门或公司内部共享标准 AI 协作配置。

### 看板任务流

任务以看板形式组织，支持待办、进行中、审查、完成等状态。每张任务卡都可以沉淀上下文、附件、评论和执行记录。

### 代码审查

Agent 产出的文件变更会进入 Diff 审查视图。你可以按文件或代码块接受、拒绝或评论，避免 AI 改动绕过工程审查。

### 消息与 Inbox

团队、成员和用户之间通过 Inbox 通信。你可以向负责人发需求，也可以直接给具体成员补充指令。

### 执行日志与诊断

Hermit 保留底层 CLI 输出、工具调用、启动状态、权限阻塞和失败原因，方便定位“为什么卡住”或“哪个成员没完成”。

### 模板与 Skills

团队角色、工作流、审查规则和项目经验可以沉淀成模板与 Skills，并通过 GitHub 或企业 Git 仓库同步。

Hermit 的 Skills 策略保持克制：重点管理全局 Skills，让团队共享通用能力；项目级细节尽量通过团队分工、任务描述、项目文档和代码约定表达，避免 Skills 爆炸。

### 飞书消息集成

Hermit 支持绑定飞书消息渠道，让团队负责人接收外部消息，并把任务进展、完成、阻塞等重要事件主动通知到协作场景中。

## 快速开始

### 桌面版

1. 安装并登录官方 [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview)。
2. 下载并启动 Hermit。
3. 选择一个本地代码目录。
4. 创建团队，配置负责人和成员角色。
5. 给负责人发送需求，例如：”重构鉴权模块，并补充单元测试。”
6. 在看板中跟进任务，在代码审查中决定是否合入改动。

如果 macOS 找不到 `claude` 命令，可以在设置里手动配置 CLI 路径，例如 `~/.claude/local/node_modules/.bin/claude`。

### Docker 部署（Linux 服务器 / 无影云桌面）

适用于没有 GUI 或 ulimit 受限的 Linux 环境。镜像内置 Claude Code CLI，agent 直接在容器内操作项目代码。

```bash
docker pull ghcr.io/yancyuu/hermit:latest
docker run -d \
  --name hermit \
  -p 3456:3456 \
  -v ~/.claude:/data/.claude \
  -v ~/my-project:/data/project \
  ghcr.io/yancyuu/hermit:latest
```

浏览器打开 `http://localhost:3456` 即可使用。Claude Code 认证通过挂载的 `~/.claude` 目录读取，无需额外登录。

环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `3456` | 监听端口 |
| `CLAUDE_ROOT` | `/data/.claude` | Claude 数据目录 |
| `CORS_ORIGIN` | `*` | CORS 策略 |

## 团队资产管理

Hermit 1.5.2 开始重点支持两类可复用资产：

| 资产 | 用途 | 推荐管理方式 |
| --- | --- | --- |
| 团队模板 | 预设负责人、成员角色、工作流和默认协作方式 | GitHub 或企业 Git 仓库 |
| 全局 Skills | 沉淀跨项目通用能力，例如审查规范、排障流程、文档协作方法 | 外部 Skills 仓库 |

推荐做法：

- 团队模板面向“组织协作方式”，例如研发团队模板、需求分析团队模板、测试审查团队模板。
- 全局 Skills 面向“通用能力”，例如代码审查、发布检查、故障复盘、文档撰写。
- 项目级知识优先放在项目文档、任务说明和团队成员分工里，而不是无限拆分成细颗粒度 Skills。

## 运行时支持

| Provider | 状态 | 说明 |
| --- | --- | --- |
| Claude Code | 默认支持 | 当前最稳定的团队运行时。 |
| Codex | Beta | 已有账号、模型和运行时配置入口，团队能力仍在验证。 |

Cursor Agent 曾作为实验适配探索，但它更接近 one-shot 运行方式，不完全匹配 Hermit 当前的持续团队语义，因此不作为当前推荐 provider 暴露。

## 和其他方案有什么不同

| 能力 | Hermit | 直接用 Claude Code CLI | Cursor 等 IDE 插件 |
| --- | --- | --- | --- |
| 多 Agent 协作 | ✅ 团队角色分工，多成员协作 | ❌ 单窗口为主 | ⚠️ 个人 IDE 辅助为主 |
| 任务管理 | ✅ 看板驱动，状态可追踪 | ❌ 无内置任务流 | ⚠️ 弱，通常依赖手工记录 |
| 代码审查 | ✅ 专用 Diff 审查面板 | ⚠️ 依赖手工 `git diff` | ⚠️ IDE 内 diff，缺少团队审查流 |
| Skills 管理 | ✅ 外部仓库统一管理全局 Skills | ⚠️ 本地文件，各自维护 | ⚠️ 各自配置，难统一分发 |
| 团队模板 | ✅ Git 仓库版本化模板 | ❌ 无 | ❌ 无 |
| 执行日志 | ✅ 结构化日志，可诊断、可复盘 | ⚠️ 终端日志，难沉淀 | ⚠️ 取决于 IDE 能力 |
| 跨平台 | ✅ 独立桌面客户端 | ✅ CLI 跨平台 | ⚠️ 依赖 IDE 与插件环境 |

## 架构概览

```text
Git 仓库源
  └─ 同步团队模板 / Skills / 工作流

Hermit 本地控制面
  ├─ 团队负责人
  │  ├─ 理解需求
  │  ├─ 拆解任务
  │  └─ 协调成员
  ├─ 协作中枢
  │  ├─ 看板
  │  ├─ 消息 Inbox
  │  ├─ 代码审查
  │  └─ 运行日志
  └─ Agent 成员
     ├─ 按角色执行任务
     ├─ 只加载相关上下文
     └─ 产出可审查变更

本地运行时
  └─ Claude Code / Codex beta

用户本地环境
  └─ 文件系统 / Git / Terminal
```

关键原则：

- 负责人是团队入口，不是全局代理服务器。
- 成员是独立执行单元，任务和上下文要尽量隔离。
- 所有重要状态都要落到任务、消息、审查和日志里。
- 多机协同优先通过 Git 仓库同步，不默认走 SSH/SFTP 分布式调度。
- 长期经验优先沉淀为模板、Skills 和可复盘记录。

## 本地开发

依赖：

- Node.js 20+
- pnpm 10+

```bash
git clone https://github.com/yancyuu/Hermit.git
cd Hermit
pnpm install
pnpm dev
```

常用命令：

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm dist:mac:arm64
pnpm dist:win
pnpm dist:linux
```

技术栈：

- Electron 40
- React 19
- TypeScript 5
- Tailwind CSS 3
- Zustand
- Claude Code / `claude` CLI
- MCP
- Git / GitHub / 企业仓库源

## 当前边界

- 当前默认并优先支持官方 Claude Code / `claude` CLI。
- Codex provider 处于 beta 阶段，功能和交互可能调整。
- 不再把 tmux 作为团队运行前置依赖。
- 不把 SSH/SFTP 分布式调度作为新功能默认方向；多机协同优先通过 Git 仓库同步。
- Skills 管理聚焦全局 Skills，不做过度细颗粒度的项目 Skills 管理。
- 中文团队名、成员名、角色名等用户可见输入应保持友好支持；内部标识会单独做安全 slug。

## 安全

Hermit 是本地优先应用。IPC 和主进程 handler 会校验 ID、路径和 payload 结构；项目编辑和写入操作限制在当前选择的项目根目录内。只读发现流程会访问 `~/.claude/` 下的 Claude 数据和 Hermit 自有状态目录。敏感配置、凭据路径和路径穿越会被阻止。

## 许可证

[AGPL-3.0](LICENSE)
