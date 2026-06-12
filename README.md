<p align="center">
  <img src="resources/icons/png/1024x1024.png" alt="openHermit" width="96" />
</p>

<h1 align="center">openHermit</h1>

<p align="center">
  <strong>Loop Engineering 工作台</strong><br/>
  用 Fastify + Vite 把 Claude Code、Codex、Gemini、Cursor、OpenCode 等本机 Agent 运行时组织成可观察、可派工、可验证的本地循环系统。
</p>

<p align="center">
  <a href="https://github.com/yancyuu/Hermit/releases/latest"><img src="https://img.shields.io/github/v/release/yancyuu/Hermit?style=flat-square&label=version&color=black" alt="最新版本" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-black?style=flat-square" alt="许可证" /></a>
  <img src="https://img.shields.io/badge/package-@yancyyu/openhermit@1.6.42-black?style=flat-square" alt="npm package" />
  <img src="https://img.shields.io/badge/local--first-~/.hermit-black?style=flat-square" alt="Local first" />
</p>

<p align="center">
  <img src="docs/screenshots/openhermit/team-list.png" alt="openHermit 团队工作台" width="100%" />
</p>

---

## openHermit 是什么？

openHermit 是本地优先的 Loop Engineering 控制台。它不提供模型、不托管你的仓库，也不把 Agent 固定成聊天窗口。你在 Web 工作台里创建团队、拆任务、派工、观察消息与事件、审查交付；实际执行由本机或基础设施中的 Agent CLI / cc-connect runtime 完成。

当前产品形态：

- **后端**：Fastify 5 + Node.js
- **前端**：Vite + React 19 + TypeScript
- **默认入口**：`/teams`
- **默认存储**：`~/.hermit/`
- **分发方式**：npm CLI 包 `@yancyyu/openhermit` v1.6.42
- **当前不包含**：Electron 桌面打包、内嵌 PTY 终端

---

## 产品截图

<table>
  <tr>
    <td align="center"><b>团队列表</b></td>
    <td align="center"><b>团队详情</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/openhermit/team-list.png" alt="团队列表" width="480" /></td>
    <td><img src="docs/screenshots/openhermit/team-detail.png" alt="团队详情" width="480" /></td>
  </tr>
  <tr>
    <td align="center"><b>全局任务</b></td>
    <td align="center"><b>设置与运行时</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/openhermit/tasks.png" alt="全局任务" width="480" /></td>
    <td><img src="docs/screenshots/openhermit/settings.png" alt="设置与运行时" width="480" /></td>
  </tr>
</table>

---

## 核心能力

| 能力 | 当前说明 |
|:---|:---|
| **团队工作台** | 默认进入 `/teams`，按团队管理成员、任务、消息、运行时配置和项目工作区 |
| **任务看板** | 维护团队内任务、评论、外部派单投影和执行状态 |
| **消息工作区** | 保存团队消息、跨团队消息和 cc-connect Bridge 事件 |
| **Loop Engineering** | 把扫描、派工、执行、验证、报告组织成可重复的工程循环 |
| **cc-connect Bridge** | 连接本机 Agent runtime、Management API、WebSocket Bridge 和外部渠道 |
| **渠道绑定** | 在团队级别配置 Feishu/Lark、微信、Telegram、Discord、Slack 等平台凭据与白名单；实际 Bot 适配由 cc-connect 承载 |
| **渠道边界** | Hermit 当前负责已支持 session key 的团队路由、权限白名单和审计；平台能力取决于 cc-connect 版本和本机配置 |
| **Worktree 隔离** | 创建或启动团队时可让成员使用独立 worktree，降低并行修改冲突 |
| **跨团队协作** | 当前通过 Redis-backed dispatch 派单实现接受、拒绝、交付、审批、修订；完整 Task Bus 是后续目标模型 |
| **本地优先** | 配置、团队、任务、消息和审计数据默认落在 `~/.hermit/` |

---

## 快速开始

### npx 直接运行

```bash
npx @yancyyu/openhermit@latest
```

启动后打开 [http://127.0.0.1:5680/teams](http://127.0.0.1:5680/teams)。

### 全局安装

```bash
npm install -g @yancyyu/openhermit@latest --prefer-online
openhermit
```

### 常用命令

```bash
openhermit                # 启动工作台
openhermit --daemon       # 后台运行
openhermit status         # 查看后台状态
openhermit stop           # 停止后台服务
openhermit --port 8080    # 指定端口
openhermit --version      # 查看版本
openhermit update         # 自更新
```

openHermit 会尝试准备本机运行时配置。真实使用 Claude Code、Codex、Gemini、Cursor、OpenCode 或外部协作渠道时，仍需在本机完成对应 CLI、账号、API key 或平台凭据配置。

## 创建第一个团队

1. 进入 `/teams`
2. 点击 **「创建数字员工」**
3. 填写团队名和 slug
4. 选择 harness / runtime（如 `claudecode`）
5. 选择项目目录；需要隔离时启用 worktree
6. 如需外部平台访问，配置渠道绑定与访问白名单
7. 保存后进入团队详情，在看板或消息区创建任务并启动 Agent

---

## 支持的 Agent 运行时

openHermit 的运行时能力取决于你安装和授权的本机 CLI、cc-connect 配置和当前适配器。

| 支持层级 | 运行时 |
|:---|:---|
| **一等适配器** | `claudecode`、`codex`、`gemini`、`opencode`、`cursor` |
| **已注册/兼容标识** | `devin`、`qoder`、`pi`、`iflow`、`acp`、`kimi`、`tmux` |

一等适配器通常提供更完整的安装状态、凭据、MCP、Skills 或环境变量管理。兼容标识用于团队配置、桥接或实验性接入，具体能力以本机环境为准。

---

## 架构边界

```text
Browser / Vite UI
  ↓ HTTP / WebSocket
Fastify API
  ↓
~/.hermit team · task · message workspace
  ↓
cc-connect Bridge / Management API
  ↓
Local agent runtimes and external channels
```

- **Team**：团队、成员、项目目录、worktree 隔离和 runtime 配置
- **Task**：团队看板、外部派单投影、交付和审核状态
- **Message**：团队消息、跨团队消息、渠道消息和 Bridge 事件
- **Channel**：cc-connect 承载平台适配；Hermit 做团队路由、白名单和审计
- **Task Bus**：当前是 Redis-backed dispatch；目标是 offer / bid / lease / event 的完整跨团队协议

---

## 技术栈

| 层级 | 技术 |
|:---|:---|
| 前端 | React 19 · TypeScript 5 · Tailwind CSS 3 · Zustand 4 · Vite |
| 后端 | Fastify 5 · Node.js |
| 运行时桥接 | cc-connect · WebSocket Bridge · HTTP Management API |
| 扩展 | MCP · Plugins · Skills · Credentials |
| 存储 | 本地文件，默认 `~/.hermit/` |
| 发布 | npm CLI package · GitHub Release；`.github/workflows/release.yml` 的 Docker job 引用 `docker/Dockerfile`，发布前需要补齐或禁用 |

---

## 文档

- [文档索引](docs/README.md)
- [Feature Architecture Standard](docs/FEATURE_ARCHITECTURE_STANDARD.md)
- [Team Management Architecture](docs/team-management/README.md)
- [Cross-Team Collaboration Workflow](docs/team-management/cross-team-collaboration.md)
- [Release Guide](docs/RELEASE.md)
- [Changelog](docs/CHANGELOG.md)

---

## 贡献

欢迎 PR。Fork → Branch → Push → PR。

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build:web
```

请使用 pnpm。不要把 Electron 打包、内嵌 PTY 或未落地的完整 Task Bus 写成当前能力。

---

## 许可证

[AGPL-3.0](LICENSE)
