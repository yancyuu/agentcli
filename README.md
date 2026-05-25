<p align="center">
  <img src="resources/icons/png/1024x1024.png" alt="openHermit" width="100" />
</p>

<h1 align="center">openHermit</h1>

<p align="center">
  <strong>超级个体的 AI 基础设施：用代码重构公司形态</strong><br/>
  告别“玩具级”的提示词角色扮演。用状态机接管工作流，让一个人成为一支军队。
</p>

<p align="center">
  <a href="https://github.com/yancyuu/Hermit/releases/latest"><img src="https://img.shields.io/github/v/release/yancyuu/Hermit?style=flat-square&label=version&color=black" alt="最新版本" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-black?style=flat-square" alt="许可证" /></a>
</p>

---

## 💡 设计哲学：为什么我们需要 openHermit？

目前的 AI Agent 赛道充满了一个巨大的误区：**大家都在试图用人类的“HR 组织架构”来管理 AI。**
让大模型扮演“资深前端”或“产品经理”，本质上是在模仿人类的**职责驱动**（因岗设人）。这注定会走向死锁——因为人类有精力上限和认知边界，才需要划分部门和扯皮；而 AI 没有。

**openHermit 是一场对传统协作模式的降维打击。** 它的核心哲学只有两条：

### 1. 对创业者：组织形态的“资产化” (OPC 范式)
**OPC（One Person Company）** 不再是一个浪漫的口号，而是最具杠杆率的商业形态。
你不需要招聘、不需要对齐价值观、不需要处理情绪内耗。你是唯一的决策者，AI 是绝对服从的执行网格。openHermit 为你提供 **TPC（Team · Process · Channel）** 协作结构，将产品、开发、测试、运营转化为可并发现程。你的每一次业务跑通，都是在积累固化的“数字资产”，而不是随员工离职而流失的经验。

### 2. 对开发者与工程师：去中心化的“状态机”驱动 (State-Driven DAG)
**用管理机器的方式管理 Agent，而不是用管理人的方式。**
Agent 的协作本质不该是“角色扮演”，而是**分布式状态机**。任务流是一张 DAG，每个节点代表一种确定的状态（Pending → Running → Review → Done）。
* **拒绝死锁**：遇到网络波动或反爬环境，状态机自动 `Fail-Over` 切换运行时，流水线永远不会因为“超出角色职责”而卡死。
* **Zero-Trust 与 Local-First**：真正的生产力工具不能是黑盒。openHermit 坚持本地优先的零信任架构。配置、项目代码、长短期记忆同步都在你的本地机器完成，彻底掌控数据主权。
* **即用即走，上下文随状态流转**：Agent 不拥有固定岗位，只有当任务状态流转到 `Ready` 时，控制面才会将当前状态、上下文（Context）和能力（Skills）动态注入给对应的 Agent 运行时。

---

## ⚙️ 核心架构：TPC 引擎

想要让 OPC 跑起来，你需要的不是一堆散落的终端窗口，而是 TPC 架构：

* **[ T ] Team（隔离与并发）**：给不同的工作建立独立团队。前端用 Claude Code 撸代码，后端用 Codex 构架，调研交由 Kimi。每个团队有独立的隔离运行时环境，但在全局协作看板上，任务可以跨团队无缝调度。
* **[ P ] Process（状态流转）**：彻底放弃“岗位 KPI”。一切以任务的原子化状态为核心，MCP Server 动态向 Agent 注入当前所需工具。
* **[ C ] Channel（全渠道触达）**：支持飞书、微信、Telegram、Discord、Slack 等 10+ 渠道接入。消息即指令，外部输入自动路由至对应 Agent 团队，支持独立上下文串或共享群会话，将你的 IM 变成公司级控制台。

---

## 🛠️ 支持的 Agent 运行时与渠道

openHermit 不提供闭源模型，也不劫持你的代码。它是一个高度可扩展的本地环境壳层。

### 极客级的多端运行时支持
创建团队时，底层 MCP Server 会自动完成零配置注入。能否启动，取决于你的算力边界。

| 标识 | 运行时说明 | 标识 | 运行时说明 |
|:---|:---|:---|:---|
| `claudecode` | Anthropic 官方 CLI | `devin` | Cognition Devin |
| `codex` | OpenAI Codex CLI | `opencode` | OpenCode CLI |
| `cursor` | Cursor IDE Agent | `qoder` | Qoder CLI |
| `gemini` | Google Gemini CLI | `pi` | Inflection Pi |
| `iflow` | iFlow CLI | `acp` | Agent Communication Protocol |
| `kimi` | Moonshot Kimi | `tmux` | 经典 Tmux Session 桥接 |

### 模块化的信使网络 (Channels)
让外部世界无缝接入你的自动化流水线：
* **研发协同**：飞书（支持高级消息卡片）、钉钉、企业微信、Slack
* **极客与海外**：Telegram、Discord、LINE
* **私域与社群**：微信、QQ
* **自定义集成**：原生支持 openHermit 内部 Bridge 协议

---

## 🚀 极速部署

### 1. 全局安装
```bash
npm install -g @yancyyu/openhermit
openhermit
```

启动后打开：

```text
http://127.0.0.1:5680
```

常用命令：

```bash
open-hermit                # 等同于 openhermit
openhermit --daemon        # 后台运行
openhermit status          # 查看后台运行状态
openhermit stop            # 停止后台服务
openhermit --port 8080     # 指定 Web 控制台端口
openhermit --version       # 查看版本
openhermit update          # 更新 openHermit
```

首次启动会自动创建本地运行时配置，并生成本地 token。通常只需要打开 `http://127.0.0.1:5680` 使用 openHermit。

### 本地开发

```bash
git clone https://github.com/yancyuu/hermit.git
cd hermit
pnpm install
pnpm dev
```

浏览器打开 `http://localhost:5174`

开发模式默认连接本机运行时服务；生产 CLI 会优先使用 openHermit 管理的本地配置。

### 创建第一个 AI 团队

1. 点击「新建团队」
2. 填写团队名、选 harness（如 `claudecode`）
3. 选择对应的本地项目和运行时
4. 保存 → 看板就绪，任务等你分配

---

## 技术栈

- **前端**：React + TypeScript + Tailwind CSS + Zustand
- **后端**：Fastify（Node.js）
- **存储**：本地文件（`~/.hermit/`）
- **通信**：本地 Bridge WebSocket + Management HTTP API
- **协议**：MCP over HTTP（SSE + JSON-RPC）

---

## 许可证

[AGPL-3.0](LICENSE)
