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
  用看板、角色、任务、消息、代码审查和运行日志，像管理工程团队一样管理 AI Agent。
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

Hermit 是一个面向软件工程的 AI Agent 团队控制面。它不是新的模型平台，而是把 Claude Code 等本地编程运行时组织成可管理的团队：

- 用团队和角色承载复杂工作，而不是把所有需求塞进一个聊天窗口。
- 用看板追踪任务状态，让计划、执行、审查和讨论都可回溯。
- 用代码审查视图接住 Agent 的改动，避免黑盒直接改坏代码库。
- 用本地文件、任务、评论、模板和 Skills 沉淀团队经验。

当前主力运行时是官方 Claude Code / `claude` CLI。Codex 作为 beta provider 正在接入和验证中。

## 为什么需要它

单窗口聊天适合临时问答，但不适合长期工程交付。随着上下文变长，常见问题会越来越明显：

- 上下文越来越大，Token 成本和延迟快速上升。
- Agent 直接修改文件，缺少清晰的审查和回滚入口。
- 任务、决策、讨论和日志散落在对话里，难以复盘。
- 好用的角色设定和工作流无法稳定复用。

Hermit 的解法是把 Agent 协作变成工程化流程：负责人拆任务，成员执行，看板承载状态，审查面板决定是否合入，日志和任务记录负责追溯。

## 核心能力

### Agent 团队

创建包含负责人、架构师、实现工程师、测试工程师、审查员等角色的团队。负责人负责理解需求和拆解任务，成员按角色执行具体工作。

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

## 快速开始

1. 安装并登录官方 [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview)。
2. 下载并启动 Hermit。
3. 选择一个本地代码目录。
4. 创建团队，配置负责人和成员角色。
5. 给负责人发送需求，例如：“重构鉴权模块，并补充单元测试。”
6. 在看板中跟进任务，在代码审查中决定是否合入改动。

如果 macOS 找不到 `claude` 命令，可以在设置里手动配置 CLI 路径，例如 `~/.claude/local/node_modules/.bin/claude`。

## 运行时支持

| Provider | 状态 | 说明 |
| --- | --- | --- |
| Claude Code | 默认支持 | 当前最稳定的团队运行时。 |
| Codex | Beta | 已有账号、模型和运行时配置入口，团队能力仍在验证。 |

Cursor Agent 曾作为实验适配探索，但它更接近 one-shot 运行方式，不完全匹配 Hermit 当前的持续团队语义，因此不作为当前推荐 provider 暴露。

## 和其他方案有什么不同

| 能力 | Hermit | 单次 Claude Code 会话 | 通用 Chat / 个人 Agent |
| --- | --- | --- | --- |
| 多角色团队 | 支持 | 不支持 | 通常不支持 |
| 看板任务流 | 内置 | 无 | 弱 |
| 代码审查 | 内置 Diff 审查 | 依赖手工查看 | 弱 |
| 上下文控制 | 按角色和任务隔离 | 容易膨胀 | 容易膨胀 |
| 经验沉淀 | 模板、Skills、任务记录 | 依赖聊天历史 | 依赖聊天历史 |
| 数据位置 | 本地优先 | 本地执行 | 取决于工具 |

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
- 中文团队名、成员名、角色名等用户可见输入应保持友好支持；内部标识会单独做安全 slug。

## 安全

Hermit 是本地优先应用。IPC 和主进程 handler 会校验 ID、路径和 payload 结构；项目编辑和写入操作限制在当前选择的项目根目录内。只读发现流程会访问 `~/.claude/` 下的 Claude 数据和 Hermit 自有状态目录。敏感配置、凭据路径和路径穿越会被阻止。

## 许可证

[AGPL-3.0](LICENSE)
