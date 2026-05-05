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

<h1 align="center"><a href="https://github.com/yancyuu/Hermit">Hermit</a></h1>

<p align="center">
  <strong>企业级 AI Agent 团队协作与管理工作台。</strong><br />
  像管理真实工程组织一样管理数字员工：通过子 Agent 架构实现上下文隔离与成本优化，将团队、角色、任务、消息、审查、日志和知识资产沉淀在同一个本地优先控制面里。
</p>

<p align="center">
  <a href="https://github.com/yancyuu/Hermit/releases/latest"><img src="https://img.shields.io/github/v/release/yancyuu/Hermit?style=flat-square&label=version&color=blue" alt="最新版本" /></a>&nbsp;
  <a href="https://github.com/yancyuu/Hermit/actions/workflows/ci.yml"><img src="https://github.com/yancyuu/Hermit/actions/workflows/ci.yml/badge.svg" alt="CI 状态" /></a>&nbsp;
  <a href="https://yancyuu.github.io/Hermit/zh"><img src="https://img.shields.io/badge/官网-Hermit-111827?style=flat-square" alt="Hermit 中文官网" /></a>&nbsp;
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="许可证" /></a>
</p>

<p align="center">
  <a href="https://github.com/yancyuu/Hermit/releases/latest/download/Hermit-arm64.dmg">
    <img src="https://img.shields.io/badge/macOS_Apple_Silicon-DMG-000000?style=for-the-badge&logo=apple&logoColor=white" alt="下载 macOS Apple Silicon DMG" />
  </a>
  <a href="https://github.com/yancyuu/Hermit/releases/latest/download/Hermit-x64.dmg">
    <img src="https://img.shields.io/badge/macOS_Intel-DMG-000000?style=for-the-badge&logo=apple&logoColor=white" alt="下载 macOS Intel DMG" />
  </a>
  <a href="https://github.com/yancyuu/Hermit/releases/latest/download/Hermit-Setup.exe">
    <img src="https://img.shields.io/badge/Windows-Setup.exe-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="下载 Windows 安装包" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/yancyuu/Hermit/releases/latest/download/Hermit.AppImage">
    <img src="https://img.shields.io/badge/Linux-AppImage-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="下载 Linux AppImage" />
  </a>
  <a href="https://github.com/yancyuu/Hermit/releases/latest/download/Hermit-amd64.deb">
    <img src="https://img.shields.io/badge/Linux-DEB-A81D33?style=for-the-badge&logo=debian&logoColor=white" alt="下载 Linux DEB" />
  </a>
  <a href="https://github.com/yancyuu/Hermit/releases/latest/download/Hermit-x86_64.rpm">
    <img src="https://img.shields.io/badge/Linux-RPM-EE0000?style=for-the-badge&logo=redhat&logoColor=white" alt="下载 Linux RPM" />
  </a>
  <a href="https://github.com/yancyuu/Hermit/releases/latest/download/Hermit.pacman">
    <img src="https://img.shields.io/badge/Linux-pacman-1793D1?style=for-the-badge&logo=archlinux&logoColor=white" alt="下载 Linux pacman 包" />
  </a>
</p>

> 如果稳定下载链接暂时不可用，请到 [Releases](https://github.com/yancyuu/Hermit/releases/latest) 页面选择对应平台资产。

<img width="1304" height="820" alt="Hermit 界面预览" src="docs/screenshots/hero.png" />

## Hermit 是什么

Hermit 是一个面向软件工程场景的 AI Agent 工作台。它不重新发明模型，也不把自己做成云端代码托管平台，而是把已经很强的编程运行时（当前默认是官方 Claude Code / `claude` CLI）放进一个可管理的团队系统里。

在 Hermit 里，你创建的不是一次性的 prompt，而是一个团队：负责人理解目标、拆分任务、分配成员；成员在独立上下文中执行；看板记录进度；评论沉淀讨论；代码审查承接 diff；日志展示真实执行过程。**你像管理一个小型工程团队一样管理 AI Agent，从而获得单会话无法企及的成本优势与工程确定性。**

Hermit 基于 `claude_agent_teams_ui` 二次开发，保留本地优先的 Claude Code 团队协作能力，并强化中文体验、团队看板、代码审查、成员运行诊断、跨团队消息、运行时适配和仓库化团队资产方向。

## 为什么需要它

编程 Agent 越来越强之后，新的问题不是“能不能写代码”，而是“如何低成本地稳定交付”。

一个真实工程任务往往包含需求澄清、上下文收集、实现、测试、审查、返工、发布和复盘。把这些全部塞进单个聊天窗口，很快会面临**上下文爆炸（导致高昂的 Token 费用）**和**注意力丢失（导致代码破坏）**。

Hermit 通过结构化系统解决这些隐性痛点：

- **把长对话变成精准分工（极致省 Token）**：传统的单窗口对话会随着任务推进累积庞大的无效上下文。Hermit 引入「负责人-成员」架构，通过子 Agent 实现上下文物理隔离。每个成员只需加载与其所分配任务严格相关的代码和记录，从而以极低的 Token 成本完成深度的特定域任务。
- **把目标变成任务（提高确定性）**：负责人把用户请求拆成看板任务，任务有状态、负责人、评论和审查记录，防止 Agent 在漫无目的的循环中空耗算力。
- **把执行变成证据（防止黑盒合入）**：每个任务的消息、工具调用、代码变更和审查意见都能回看。强制的 Code Review 环节拦截不合格的 Diff。
- **把经验变成资产（降低复用成本）**：团队模板和 Skills 可以通过 GitHub / 企业 Git 源版本化、审查、同步和复用。
- **把运行时变成可替换底座**：Claude Code 是当前默认能力，Cursor CLI 作为可选运行时方向逐步探索。

## 产品理念

### 关注组织架构带来的降本增效
相比于给大模型喂更长的上下文，合理的团队协作拓扑才是复杂系统工程的解法。通过子任务分发机制，Hermit 从根本上规避了无脑消耗 Context Window 的陷阱，使并发执行和精细化控制成为可能。

### 少造底座，多沉淀组织资产
Hermit 不试图成为所有模型、消息平台和工具调用的总网关。模型和代码执行能力会持续进化，Hermit 更关注长期不该丢失的部分：任务事实、协作协议、审查标准、团队分工、运行记录和企业内部知识。

### 本地优先，不托管核心代码
Hermit 运行在你的机器上，读取你选择的项目目录和本地 Claude 数据。真实代码执行发生在本地工作站或你信任的运行环境里。Hermit 负责组织、观察和记录，而不是把代码交给一个额外的中心控制面。

### 仓库同步，而不是远程遥控
多机协同的默认方向不是 SSH/SFTP 式分布式调度。每台机器安装 Hermit，连接同一组团队模板源和 Skills 源，通过 Git 分支、PR 和企业代码库完成协作。仓库就是跨机器和跨团队的边界。

### 中文优先，专注开发者体验
Hermit 默认面向中文用户。可见文案、团队创建、成员管理、任务评论、确认对话和错误提示都优先使用简体中文。针对国内或特定系统环境下，Windows 慢启动、权限阻塞等坑位做了深度调优和退让策略。

## 核心能力

### Agent 团队分工调度
- 创建负责人和多个成员组成的团队，隔离任务上下文。
- 成员可以拥有不同角色、工作流、模型和运行方式。
- 团队启动按小批次并发拉起成员，减少限流和慢机器误判。

### 看板任务流与代码审查
- 任务从待办、进行中、审查到完成形成闭环。
- 专属的代码审查视图：按任务查看文件变更和 diff，支持接受、拒绝或具体评论。
- 彻底告别 Agent 写完直接强制保存的恐慌感，保留人类工程师的最终控制权。

### 消息与协作
- 负责人和成员通过 Inbox 进行消息协作。
- 支持用户直接给成员发消息、跨团队沟通和任务引用链接。
- 沟通记录沉淀到任务级记忆中，避免对话流失。

### 执行日志与诊断
- 展示 Claude CLI / Agent 运行日志、工具调用、思考片段、消息和错误。
- 提供底层的进程状态、启动超时、权限阻塞等诊断信息。

### Skills 与团队模板（规划中演进方向）
- 支持配置多个 GitHub / 企业 Git 源。
- 角色、工作流、审查标准、排障手册等非标准资产可通过代码仓库同步、版本化。

## 和常见方案的区别

| 能力 | Hermit | 官方 Claude 单会话 | OpenClaw / 个人 Agent | Vibe Kanban / OpenHands |
| --- | ---: | ---: | ---: | ---: |
| **Token 与上下文成本控制** | **基于子 Agent 隔离，极度优化** | 随对话长度线性爆炸 | 部分隔离 | 部分隔离 |
| 直接复用 Claude Code Runtime | 是 | 是 | 否 | 部分 |
| 负责人 + 成员的团队模型 | 是 | 否 | 部分 | 部分 |
| 看板任务闭环 | 是 | 否 | 否 | 是 |
| 代码审查 / diff 审批拦截 | 是 | 否 | 否 | 部分 |
| 本地优先，不托管核心代码 | 是 | 是 | 是 | 部分 |
| Skills / 团队模板版本化 | 规划中 | 否 | 部分 | 否 |

*Hermit 的核心取舍是：不重新发明 Agent 大脑，而是在强运行时之上，用团队分治和闭环流程压降成本，并带来确定性的工程交付。*

## 快速开始

1. 安装并启动 Hermit。
2. 确保本机已安装并登录官方 Claude Code / `claude` CLI。
3. 选择一个项目目录。
4. 创建团队，填写团队目标、成员、角色和工作方式。
5. 启动团队，观察成员启动状态和看板任务。
6. 在消息、任务详情、执行日志和代码审查中介入协作。

*提示：如果 macOS 图形界面启动后找不到 `claude`，请确认 Claude Code 已安装，或在设置里配置 CLI 路径。常见路径包括 Homebrew、npm/nvm、`~/.claude/local/bin` 等。*

## 架构概览

```text
GitHub / 企业 Git 源
        |
        +--> Skills / 团队模板 / 运行时预设
        |
        v
Hermit 本地工作台 (控制平面)
        |
        +--> 团队负责人 team-lead (解析需求 / 任务拆解分发 / 外部沟通)
        |       |
        |       +--> 【隔离区 A】成员 1：负责模块 A 开发 (低 Token 消耗)
        |       +--> 【隔离区 B】成员 2：负责单元测试 (独立上下文)
        |
        +--> 状态中心：看板任务 / 跨成员消息总线 / 代码审查 Diff / 执行审计日志
        |
        +--> Agent Runtime (运行时)
        |       |
        |       +--> Claude Code / Cursor CLI ...
        |
        +--> 本地项目目录 / 用户可信执行环境
```

关键原则：

- 负责人是团队入口，不是全局代理服务器。
- 成员是独立执行单元，不让负责人代替成员消费普通成员 Inbox。
- 任务、消息、审查和运行状态都要落到可追踪状态里。
- 多机协同优先通过 Git 仓库同步，不提前引入复杂分布式调度。
- 长期记忆优先沉淀到任务、评论、审查记录、模板和 Skills。

## 开发

依赖：Node.js 20+、pnpm 10+。

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

项目技术栈：

- Electron 40
- React 19
- TypeScript 5
- Tailwind CSS 3
- Zustand
- Claude Code / `claude` CLI
- MCP
- Git / GitHub / 企业仓库源

## 当前边界

- 优先支持官方 Claude Code / claude CLI。Cursor CLI 适配器处于基础探索阶段。

- 不把 SSH/SFTP 分布式调度作为新功能默认方向，多机协同优先通过代码仓库同步。

- 团队成员启动采用小批次并发和保守的启动等待窗口，大幅减少 Windows 慢机器或杀软引起的启动失败。


## 安全

IPC 和主进程 handler 会校验 ID、路径和 payload 结构。项目编辑和写入操作限制在当前选择的项目根目录内；只读发现流程会访问 `~/.claude/` 下的 Claude 数据和应用自有状态目录。敏感配置、凭据路径和路径穿越会被阻止。

## 许可证

[AGPL-3.0](LICENSE)
