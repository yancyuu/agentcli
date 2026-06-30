<p align="center">
  <img src="resources/icons/png/1024x1024.png" alt="AgentCli" width="96" />
</p>

<h1 align="center">AgentCli</h1>

<p align="center">
  <strong>AI 编程工具用量采集 & 团队协作平台</strong><br/>
  自动监控 Claude Code、Codex、Cursor、Gemini 等工具的 token 消耗，上报至 AgentBus，提供团队看板与 IM 协作。<br/>
  <sub>Local-first usage tracking & team collaboration for AI coding tools.</sub>
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

你的团队每天在用 Claude Code、Codex、Cursor、Gemini……**花了多少 token？谁在用？用在哪？**

AgentCli 帮你回答这些问题：

- **自动采集** — 无侵入扫描本地 AI Agent 会话日志，零配置识别 token 消耗
- **统一上报** — 采集数据汇总至 AgentBus，企业管理者在看板一目了然
- **团队协作** — IM 消息路由（飞书/微信/Discord/Slack）、任务派发、多 Agent 编排

---

## 30 秒快速体验

```bash
npx @yancyyu/openhermit@latest
```

打开 [http://127.0.0.1:5680](http://127.0.0.1:5680)，即可看到本地 Web 工作台。

```bash
# 或全局安装
npm install -g @yancyyu/openhermit@latest
openhermit
```

---

## 核心能力

| | 能力 | 说明 |
|:---:|:---|:---|
| 1 | **自动采集** | 扫描 `~/.claude/`、`~/.codex/` 等本地会话，自动识别 token 用量、会话数、消息量 |
| 2 | **统一上报** | 通过 AgentBus 数据总线上报，支持断点续传、幂等去重 |
| 3 | **企业看板** | 按团队 / 成员 / 工具 / 时段维度展示用量，管理者实时掌握 AI 投入 |
| 4 | **IM 协作** | 飞书 / 微信 / Discord / Slack 消息路由，数字员工直接在群聊中执行任务 |
| 5 | **Web 工作台** | 本地 Web UI 管理团队、任务、消息、运行时配置，`openhermit web` 一键打开 |
| 6 | **多运行时** | 统一协调 Claude Code / Codex / Gemini / Cursor / OpenCode 等本地 Agent |

---

## 支持的 AI 编程工具

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
