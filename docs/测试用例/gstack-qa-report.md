# Hermit gstack QA 执行报告

> 执行方式:gstack 无头浏览器(harness)+ Fastify API 直测,对照 `docs/测试用例/agent.md`。
> 环境:Web 模式 Fastify `:5680` + Vite `:5174`,分支 `spec/11-team-isolation-containers`。
> 日期:2026-06-14。证据截图:`/tmp/hermit-gstack-qa/0[1-7]-*.png`。

## 结论(ship-readiness)

**SHIP_READY_WITH_MINOR_UX_GAPS** — 核心链路(团队、跨团队派单全生命周期、消息管道、扩展商店)全部通过且护栏精确;发现 2 个 P2 体验问题、1 个待确认项;e2e/playwright 与若干深度域尚未覆盖。

---

## PASS(功能验证)

### TEAM-004 跨团队派单全生命周期 —— 完整闭环 ✅(本次最高价值)
dispatchId `907bd320-…`,team-jcve(测试)→ team-3ond(爬虫):

| 步骤 | 动作 | 结果 | 用例 |
|---|---|---|---|
| send | POST /api/cross-team/send | `ok:true` status `received`,目标团队建 TODO `t_mqcjsmlz_ukjm7e`,board 反映 | TEAM-004-001 ✅ |
| start | POST /api/teams/.../start | `{notifiedOwner:true,crossTeamStarted:true}`,board `received→in_progress` | TEAM-004-002 ✅ |
| complete_task | MCP tools/call | 任务 `status:done` | (done 路径) ✅ |
| deliver | POST /api/cross-team/deliver | `ok:true`,board `→delivered` | TEAM-004-004 ✅ |
| approve | POST /api/cross-team/approve | `ok:true`,board `→approved` | TEAM-004-005 ✅ |

**3 个完整性护栏全部精确触发:**
- deliver 前任务未 done → `"Task result cannot be delivered before the agent marks the task done."` (TEAM-004-011 ✅)
- approve 前未 delivered → `"Invalid collab task transition: in_progress -> approved; expected delivered"` (TEAM-004-010 ✅)
- agent 处理中手动完成 → `"Agent 正在处理中,不能手动完成或取消…"` (TEAM-003-007 ✅,防 silent-restart 竞态)
- approve 校验缺 `team_slug` → `"team_slug and dispatch_id are required"`(参数校验 ✅)

**消息联动**:approve 自动向 team-3ond 收件箱写入系统通知 `[跨团队任务审核通过] "[gstack-QA] 生命周期验证…"`,稳定 ID `m_mqcjxbyw_9r9j76`,**仅出现一次**(TEAM-004-005 双向通知 ✅ + 现场去重 ✅)。

### 烟测 ✅
- UI 加载 `/teams`,HTTP 200,**0 console error**,全部请求 200。
- API `/api/teams` 返回 22 个团队;`/api/cross-team/discover` 团队 online + collaboration:true。

### UI 渲染 ✅
- 团队列表:22 团队卡片(名称/状态/会话·消息·token·在线时长统计)、搜索、筛选、创建入口。
- 团队详情 `/team/hermit`:成员、会话/外部派单/指令台可折叠区、看板网格/列视图切换、消息角色(hermit/user)。
- 扩展商店 `/extensions`(body 52847):oh-my-claudecode 已装、42crunch/adobe/agent-sdk 待装、"仅已安装"过滤(EXT-001-A ✅)。
- 系统管理 `/system-manager`:工作目录、运行时、命令控制台(SYS-004-A ✅)。

### 消息管道回归 ✅
- 单测 `mergeTeamMessages` + `teamMessageFiltering` = **8/8 green**(去重/过滤回归面)。
- 现场证据:派单/审批产生的系统消息 ID 稳定且无重复。

---

## 发现(问题 / 待确认)

| # | 级别 | 现象 | 建议 |
|---|---|---|---|
| F-1 | P2 UX | 首次加载 `/teams` 主内容区**完全空白**(`document.body.innerText.length === 0`),仅顶部 TabBar,直到点击"团队"才出内容。首启用户看到空屏。 | 无 tab 时显示空状态 CTA(如"新建团队/打开团队")。 |
| F-2 | P2 | **深链直跳** `/team/hermit`(goto)渲染不完整(仅标题,无视图切换按钮),而经 UI 点击进入则完整(body 4065)。直接 URL 加载可能 tab 状态未初始化。 | 复核深链路由是否正确恢复 tab/pane 状态。 |
| F-3 | 待确认 | `/tasks` 标签页内容极轻(body 131)。 | 确认是否预期(任务总线空?)还是渲染缺失。 |
| — | 信息 | `wait --networkidle` 永不 settle(SSE 持续轮询)。 | 预期行为,非缺陷;测试脚本勿依赖 networkidle。 |

---

## 未覆盖(需后续补测)
- 看板 CRUD 在**有数据看板**上的 UI 全流程(本次所有团队 board 均空)。
- **e2e playwright**:仓库无 `playwright.config`/无 `.spec`(agent.md §5.5 最大空白)。
- IPC 参数校验批量、持久化 schema 迁移、CLI 认证 onboarding 端到端、飞书/微信路由 e2e。
- `appendMessage` ID 传播集成测试、`relay 循环` / `silent restart` 专项回归(agent.md §5.3 ❌)。

---

## 证据清单(`/tmp/hermit-gstack-qa/`)
- `01-home.png` — 空白首屏(F-1)
- `02-teams-annotated.png` — 团队列表
- `03-team-detail.png` — 团队详情 + 看板 + 指令台
- `04-kanban.png` — 看板视图
- `05-extensions.png` — 扩展商店
- `06-tasks.png` — 任务标签页(F-3)
- `07-systemmanager.png` — 系统管理 / Admin Loop
