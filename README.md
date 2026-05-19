<p align="center">
  <img src="resources/icons/png/1024x1024.png" alt="Hermit" width="100" />
</p>

<h1 align="center">Hermit</h1>

<p align="center">
  <strong>AI 研发团队的指挥中心</strong><br/>
  让 AI 不再是个人助手，而是你的工程团队
</p>

<p align="center">
  <a href="https://github.com/yancyuu/Hermit/releases/latest"><img src="https://img.shields.io/github/v/release/yancyuu/Hermit?style=flat-square&label=version&color=blue" alt="最新版本" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="许可证" /></a>
</p>

<p align="center">
  <a href="https://github.com/yancyuu/Hermit/releases/latest/download/Hermit-arm64.dmg"><img src="https://img.shields.io/badge/macOS-下载-000000?style=for-the-badge&logo=apple&logoColor=white" alt="macOS" /></a>
  <a href="https://github.com/yancyuu/Hermit/releases/latest/download/Hermit-Setup.exe"><img src="https://img.shields.io/badge/Windows-下载-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Windows" /></a>
  <a href="https://github.com/yancyuu/Hermit/releases/latest/download/Hermit.AppImage"><img src="https://img.shields.io/badge/Linux-下载-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Linux" /></a>
</p>

---

## 一句话说清楚

**Claude Code 是一个人写代码，Hermit 是一支 AI 团队在写代码。**

你负责想清楚要做什么，Hermit 帮你组建团队、分配任务、追踪进度、审查代码。

---

## 它能帮你做什么

### 组建 AI 团队

不用再把所有需求塞进一个聊天窗口。创建一个团队，设定负责人、工程师、测试、审查员等角色，每个角色专注自己的事。

### 任务自动流转

给负责人说一句话，比如"重构登录模块并补充测试"，它会自动拆解任务、分配给合适的成员、在看板上追踪状态。

### 代码审查不漏改

AI 改的每一行代码都会进入审查视图，你可以逐文件、逐代码块决定是否合入，避免 AI 产出绕过工程规范。

### 对话飞书直接用

在飞书群里 @ 机器人就能给团队派任务，执行结果自动推送回群聊，不用切换工具。

### 团队经验可复用

角色配置、工作流、Skills 都能沉淀成模板，通过 Git 仓库在团队内共享，新人入职直接用。

---

## 和其他工具有什么不同

| | Hermit | Claude Code CLI | OpenClaw / Hermes |
|---|---|---|---|
| **定位** | AI 团队工作台 | 个人编程助手 | Agent 编排框架 |
| **使用方式** | 看板 + 对话 | 终端命令 | 代码配置 |
| **多 Agent** | 内置团队角色 | 单会话 | 需自己编排 |
| **任务管理** | 看板自动流转 | 无 | 无或需集成 |
| **代码审查** | 专用审查面板 | 需手动 diff | 无 |
| **飞书集成** | 开箱即用 | 无 | 无 |
| **上手成本** | 下载即用 | 需要命令行 | 需要写代码 |

**简单说：**
- **Claude Code** 是引擎，一个人开车用
- **OpenClaw / Hermes** 是造车工具，适合开发者自己组装
- **Hermit** 是整车，下载就能带一支 AI 团队开工

---

## 适合谁用

- **技术负责人**：把需求丢给 AI 团队，在看板上跟进，审查产出代码
- **研发团队**：统一管理 AI 工具和 Skills，避免每人各搞一套
- **想用 AI 但不想写配置的人**：下载安装，创建团队，开干

---

## 快速开始

### 桌面版（推荐）

1. 安装 [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview) 并登录
2. 下载 Hermit，打开
3. 选择你的项目目录
4. 创建团队，配置角色
5. 给负责人发需求，看板跟进

### Docker（服务器 / 云桌面）

```bash
docker run -d -p 4567:4567 \
  -v ~/.claude:/data/.claude \
  -v ~/my-project:/data/project \
  ghcr.io/yancyuu/hermit:latest
```

浏览器打开 `http://localhost:4567`，认证通过挂载的 `~/.claude` 目录自动读取。

---

## 核心功能预览

<p align="center">
  <a href="docs/screenshots/hero.png"><img src="docs/screenshots/hero.png" width="100%" alt="Hermit 界面预览" /></a>
</p>

| 功能 | 说明 |
|---|---|
| **看板** | 任务状态实时流转，支持待办/进行中/审查/完成 |
| **团队** | 多角色协作，负责人拆任务，成员按角色执行 |
| **代码审查** | Diff 视图，逐文件接受/拒绝/评论 |
| **工作空间** | 实时查看团队改动了哪些文件 |
| **飞书** | 群聊 @ 机器人派任务，结果自动推送 |
| **执行日志** | 完整记录 AI 工作过程，方便复盘排障 |
| **模板** | 团队配置沉淀成模板，Git 仓库共享 |
| **Skills** | 全局能力统一管理，避免重复建设 |

---

## 技术栈

Electron + React + TypeScript + Tailwind CSS + Zustand

运行时：Claude Code CLI（默认）/ Codex（Beta）

---

## 许可证

[AGPL-3.0](LICENSE) — 免费开源，100% 本地运行，无需 API Key，无需配置。
