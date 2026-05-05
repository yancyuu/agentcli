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
  <strong>企业级 AI Agent 团队协作与管理工作台</strong><br />
  像管理真实工程组织一样管理数字员工：通过<strong>子 Agent 架构</strong>实现上下文隔离与成本优化，将团队、角色、任务、消息、审查、日志和知识资产沉淀在同一个本地优先控制面里。
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

> 稳定下载链接如暂时不可用，请前往 [Releases](https://github.com/yancyuu/Hermit/releases/latest) 页面选择对应平台资产。

<img width="1304" height="820" alt="Hermit 界面预览" src="docs/screenshots/hero.png" />

---

## ✨ 什么是 Hermit？

Hermit 是一个面向软件工程场景的 **AI Agent 工作台**。它不重新发明模型底座，而是将目前最强的编程运行时（当前默认官方 Claude Code / `claude` CLI）接入到一个**可管理的团队协作系统**中。

在 Hermit 里，你不再发送一次性的 Prompt，而是构建一个团队。你像管理真实工程团队一样管理 AI：分配任务、查看进度、审查代码。**Hermit 为你带来的，是单窗口聊天永远无法企及的成本优势与工程确定性。**

---

## 🎯 核心痛点与解决方案 (Core Value)

随着编程 Agent 能力提升，“如何低成本稳定交付”成为最大痛点。单聊天窗口模式往往会导致**上下文爆炸**、**Token 费用失控**以及**代码破坏**。Hermit 通过结构化设计解决这些问题：

*   **📉 物理隔离防 Token 爆炸（省钱即正义）**
    *   *痛点*：单会话随任务推进，会累积庞大的无效上下文，单次请求成本激增。
    *   *解决*：采用「负责人-子成员」架构。任务被拆解至不同子 Agent，每个成员**仅加载与该任务相关的最小代码上下文**，大幅压降算力空耗。
*   **🛡️ 拒绝黑盒，强制代码审查（工程确定性）**
    *   *痛点*：Agent 直接修改文件，出现 Bug 难以排查。
    *   *解决*：专属的 **Diff 代码审查视图**。每一行代码合入前，必须经过人类工程师或审查 Agent 的明确 Approve / Reject，确保代码库安全。
*   **🗂️ 经验资产仓库化（复用与沉淀）**
    *   *痛点*：优秀的排障流程和规范随着 Session 结束而流失。
    *   *解决*：将角色、工作流、审查标准等沉淀为 **Skills 和团队模板**，支持通过 GitHub/企业 Git 版本化同步，让个人经验变成团队资产。
*   **💻 绝对的本地优先（隐私与数据保护）**
    *   *痛点*：SaaS 化 Agent 托管平台存在代码泄露风险。
    *   *解决*：控制面与数据全在本地。Hermit 仅负责组织调度，代码执行发生在你信任的本地环境内。

---

## 🚀 核心功能模块

### 1. 敏捷看板与任务流闭环
*   任务状态追踪（待办/进行中/审查/完成）。
*   负责人解析需求，自动生成并分配看板任务给特定成员。
*   执行结果、附件及讨论沉淀在任务详情内，不再散落于对话中。
<a href="docs/screenshots/8.png"><img src="docs/screenshots/8.png" width="75" alt="任务详情" /></a>&nbsp;

### 2. 独立 Inbox 与消息总线
*   负责人与子成员各自拥有独立的 Inbox。
*   支持人类与指定成员直接对话、跨团队协作及任务卡片引用。
<a href="docs/screenshots/3.png"><img src="docs/screenshots/3.png" width="75" alt="智能体评论" /></a>&nbsp;


### 3. 执行诊断与全景日志
*   保留所有 Claude CLI/Agent 的底层运行日志、工具调用（Tool Calls）及思考链（CoT）。
*   可视化展示进程状态、权限阻塞及超时等诊断信息。
 <a href="docs/screenshots/9.png"><img src="docs/screenshots/9.png" width="75" alt="执行日志" /></a>&nbsp;


### 4. 专为中文开发者调优
*   界面与交互全链路汉化（支持中文团队、角色及确认指令）。
*   针对 Windows 慢启动、杀毒软件拦截等坑位实施了弹性的并发控制与等待窗口。
<a href="docs/screenshots/2.png"><img src="docs/screenshots/2.png" width="75" alt="团队视图" /></a>&nbsp;

---

## 📊 与现有方案的区别

| 能力维度 | Hermit | 官方 Claude 单会话 | 通用 Chat/个人 Agent | 任务型 (OpenHands等) |
| :--- | :--- | :--- | :--- | :--- |
| **Token 与上下文成本控制** | 🟢 **基于子 Agent 强隔离，极致省流** | 🔴 随对话长度线性爆炸 | 🟡 弱隔离 | 🟡 部分隔离 |
| **代码审查 (Diff Review)** | 🟢 **内置审查视图，支持拒收/返工** | 🔴 黑盒直接覆盖文件 | 🔴 无 | 🟡 部分支持 |
| **多角色团队看板调度** | 🟢 **支持** (负责人与执行者分离) | 🔴 否 | 🟡 部分支持 | 🟢 支持 |
| **组织知识仓库化 (Skills)** | 🟢 **支持 Git 版本化同步 (规划中)** | 🔴 无持久化 | 🟡 本地配置 | 🔴 否 |
| **本地代码资产零托管** | 🟢 **纯本地调度执行** | 🟢 本地执行 | 🟢 本地执行 | 🟡 部分云托管 |

---

## 🏁 快速开始

1. **环境准备**：确保本机已安装并登录官方 [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview) (`claude` CLI)。
2. **启动应用**：运行 Hermit 并选择你的目标代码目录。
3. **构建团队**：创建一个包含“技术负责人”、“业务开发”、“测试”等角色的 AI 团队。
4. **派发任务**：向负责人发送需求，如：“*重构本项目的用户鉴权模块，并补充单元测试*”。
5. **看板协作**：观察看板任务拆解，通过消息跟进进度，并在“代码审查”面板合入最终代码。

> *注：若 macOS 下提示找不到 `claude` 命令，请在设置中手动配置 CLI 路径（如 `~/.claude/local/bin` 或 NVM/Homebrew 路径）。*

---

## 🏗️ 架构概览

```text
远程 Git 源 (GitHub / 企业私有仓)
        │
        └──> [同步] 团队模板 / Skills 规范 / 预设工作流
               │
               ▼
Hermit 控制平面 (本地优先)
        │
        ├──> 🧠 团队负责人 (Team Lead)
        │       ├── 解析需求 / 拆解任务
        │       └── 跨团队沟通 / 状态分发
        │
        ├──> 🚦 协作中枢
        │       ├── 看板任务流 (Todo/Doing/Review/Done)
        │       ├── 代码审查 Diff 面板
        │       └── 消息 Inbox 总线
        │
        └──> 👷 子 Agent 集群 (上下文物理隔离)
                ├── [成员A] 负责 UI 调整 (加载少量关联视图代码)
                ├── [成员B] 负责 DB 迁移 (加载数据库 Schema)
                │
                ▼ (驱动底层运行时)
Agent Runtime
        └──> Claude Code (默认) / Cursor CLI (探索中)
               │
               ▼
用户可信执行环境 (本地文件系统 / Terminal)
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
