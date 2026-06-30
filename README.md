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

## 常用命令

```bash
openhermit              # 终端导航器（交互菜单）
openhermit web          # 打开浏览器工作台
openhermit --daemon     # 后台运行
openhermit status       # 查看状态
openhermit stop         # 停止后台
openhermit update       # 自更新
```

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
