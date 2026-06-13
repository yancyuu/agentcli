# Worker Society 插件 · 功能测试用例全集（闭环 spec）

> 本文件是 **worker-society 插件** 的完整功能测试用例规范：去中心化自治社会的每一条功能路径都有对应用例，
> 形成端到端闭环。每条用例含：场景 / **验收通过** / **验收失败** / 类型 / 优先级 / **现有测试映射**。
> 用例 ID 规则：`SOCIETY-<域>-<序号>`，如 `SOCIETY-002-005`。
> 执行 runbook（命令、报告格式、判定）见同目录 [`agent.md`](./agent.md) 的「Worker Society（SOCIETY-*）」一节。

---

## 0. 模块全景与闭环

### 0.1 这是什么
`src/features/worker-society/` 是一个**去中心化、自治的 worker 社会**，取代集中式派单（dispatch）：
- worker 把 **Need** 发布到**广场（Agora）**；
- worker 按 **FitScore**（能力 + 负载公平 + 声誉 + 关系 + 兴趣加权）**自荐（volunteer）**；
- 系统按适配度**择优选派（selectAssignee）**，全程无人工指派；
- 协作完成后累积 **声誉（Reputation）** 与有向 **关系（Relationship）**。

### 0.2 代码分层（每层都有测试）
| 层 | 路径 | 职责 | 测试文件 |
|---|---|---|---|
| 领域模型 | `core/domain/models/society.ts` | WorkerProfile / PublishedNeed / Relationship / NeedStatus | （被各策略测试间接覆盖） |
| 纯策略 | `core/domain/policies/societyPolicies.ts` | FitScore、autonomousVolunteers、transitionNeed、声誉 delta | `societyPolicies.test.ts` |
| 应用服务 | `core/application/WorkerSocietyService.ts` | 编排领域 + 端口（17 方法） | `WorkerSocietyService.test.ts` |
| 基础设施 | `main/infrastructure/` | FsStores（`~/.hermit/society/`）+ CrossTeamMessageGateway | `fsStores.test.ts`、`crossTeamMessageGateway.test.ts` |
| 组合根 | `main/composition/societyComposition.ts` | `createWorkerSociety()` 装配 | `societyComposition.test.ts` |
| 插件描述符 | `main/composition/workerSocietyPlugin.ts` | `openhermit add worker-society` | `workerSocietyPlugin.test.ts` |
| 输入适配器 | `main/adapters/input/` | Fastify `/api/society/*` + `society_*` MCP（13 工具） | `societyRoutes.test.ts`、`societyMcp.test.ts` |
| 渲染层 | `renderer/` | api 客户端 / Zustand / 视图工具 / 图谱投影 / 挂载 | 4 个 `*.test.ts` |

**现状：13 个测试文件，213 个用例，全绿。**（`node_modules/.bin/vitest run src/features/worker-society`）

### 0.3 核心闭环（Need 生命周期 + 自治回路）

```
publishNeed ──▶ open
   │  volunteerFor (worker 自荐，按 FitScore)
   ▼
open + volunteers ──▶ selectAssignee (择优) ──▶ assigned
   │  startNeed(worker)
   ▼
in_progress ──▶ deliverNeed(result) ──▶ delivered
   │  acceptDelivery (审核通过)
   ▼
closed   ← 声誉 +、Relationship collaborations+1 / trust 更新
```

旁路：`cancelNeed` → cancelled；`requestRevision` → delivered 回 assigned（revisionCount+1）；`expireNeeds` → expired。

**自治回路（一键「触发自治」）：**
`runAutonomyTick()`（`autonomousVolunteers`：贪婪按 FitScore 自荐，受 `maxVolunteersPerNeed`/`maxNeedsPerWorker` 双向配额约束）→ `autoSelectPending()`（对每个有自荐者的 open 需求择优选派）。

### 0.4 NeedStatus 与可见性
| NeedStatus | 在看板/图谱 | task 节点状态 | 粒子（ownership 边） |
|---|---|---|---|
| open | ✓ active | waiting | 无（无 assignee） |
| assigned | ✓ active | waiting | ✓ cyan task_assign |
| in_progress | ✓ active | active | ✓ cyan task_assign |
| delivered | ✓ active | complete | 无 |
| closed / expired / cancelled | ✗ 丢弃 | — | — |

`ACTIVE_NEED_STATUSES = { open, assigned, in_progress, delivered }`（见 `societyPolicies.ts`）。

### 0.5 类型 / 优先级图例
| 类型 | 含义 | 工具 |
|---|---|---|
| unit | 纯函数/单模块 | vitest |
| integration | 跨模块/真实文件系统/Fastify inject | vitest |
| e2e | 真实 UI 全流程 | playwright（hermit 当前无 config）/ 手动 |
| manual | 需人工观测（视觉/交互） | 人工 + 截图 |

优先级：**P0** 核心链路/数据安全/历史回归点（必须全绿）；**P1** 主功能完整性；**P2** 体验/边角。

覆盖标记：✅ 已有测试 · ⚠️ 部分 · ❌ 缺口（必补）。

---

## 1. SOCIETY-001 · Worker 注册与发现

**文件**：`societyPolicies.ts`（`discoverWorkers`、`capabilityMatchScore`）、`WorkerSocietyService.ts`（`registerProfile`/`getProfile`/`discoverWorkers`）、`societyRoutes.ts`、`societyMcp.ts`

| ID | 场景 | 验收通过 | 验收失败 | 类型 | 优先级 | 现有测试 |
|---|---|---|---|---|---|---|
| SOCIETY-001-001 | `registerProfile({workerId,name,capabilities,interests,maxConcurrent,reputation})` | worker 落盘 `~/.hermit/society/profiles/`，字段完整、status 默认 online | 字段丢/默认错 | integration | P0 | ✅ service + fsStores |
| SOCIETY-001-002 | 重复注册同 workerId | 幂等：覆盖更新或保留（行为一致、不崩） | 崩/产生重复 | integration | P1 | ✅ service |
| SOCIETY-001-003 | `getProfile(workerId)` 命中 | 返回完整 profile | 缺字段 | unit | P1 | ✅ |
| SOCIETY-001-004 | `getProfile(unknown)` | 返回 undefined/null（不抛） | 抛错 | unit | P1 | ✅ fsStores（missing worker） |
| SOCIETY-001-005 | `discoverWorkers(capabilities)` | 只返回能力命中的 worker，按命中度排序 | 全返回/排序错 | unit | P0 | ✅ mcp + policies |
| SOCIETY-001-006 | `capabilityMatchScore` 空交集 | 0 分 | 误给分 | unit | P1 | ✅ policies |
| SOCIETY-001-007 | kind: atomic vs composite | 两种均合法、持久化保留 | kind 丢 | unit | P2 | ✅ service |
| SOCIETY-001-008 | maxConcurrent=0 / 负 | `isAtCapacity` 视为已满 / 拒绝自荐 | 仍允许 | unit | P1 | ✅ policies |
| SOCIETY-001-009 | `interestOverlap` 计算 | 正确计数共同兴趣 | 漏算 | unit | P2 | ✅ policies |
| SOCIETY-001-010 | 渲染层：UI「注册成员」表单 → store.registerWorker | 名称必填、工号默认=名称、能力逗号分隔 | 空名提交/崩 | e2e | P2 | ⚠️ store 路径已测，UI 未测（无 testing-library） |

- **风险点**：workerId 大小写/空白未归一化可能造成重复；maxConcurrent 边界。

---

## 2. SOCIETY-002 · Need 全生命周期（核心闭环）

**文件**：`societyPolicies.ts`（`transitionNeed`、`volunteerFor`）、`WorkerSocietyService.ts`（`publishNeed`→`acceptDelivery`）、`societyRoutes.ts`、`societyMcp.ts`

| ID | 场景 | 验收通过 | 验收失败 | 类型 | 优先级 | 现有测试 |
|---|---|---|---|---|---|---|
| SOCIETY-002-001 | `publishNeed({postedBy,subject,requiredCapabilities,priority})` | 落盘、status=open、生成 needId、createdAt | 字段缺/状态错 | integration | P0 | ✅ service + routes + mcp |
| SOCIETY-002-002 | `listOpenNeeds` / `listActiveNeeds` / `listAllNeeds` | 各自按状态集过滤正确 | 串档 | unit | P0 | ✅ |
| SOCIETY-002-003 | `volunteerFor(needId,workerId)` | volunteers+1、记 fitScore+volunteeredAt | 重复自荐/能力不符未拦 | integration | P0 | ✅ |
| SOCIETY-002-004 | 同一 need 重复 volunteer | 幂等（不计第二次）或按策略拒绝 | 无限叠加 | unit | P1 | ✅ policies |
| SOCIETY-002-005 | `selectAssignee(needId)` | 取 fitScore 最高者 → status=assigned、assignee 设置 | 选错/无自荐者仍选 | unit | P0 | ✅ |
| SOCIETY-002-006 | select 时 need 无自荐者 | 安全返回（不崩、不改状态） | 崩 | unit | P1 | ✅ |
| SOCIETY-002-007 | `startNeed(needId,workerId)` | assigned→in_progress、activeTaskCount+1 | 非 assignee 启动/状态错 | integration | P0 | ✅ |
| SOCIETY-002-008 | `deliverNeed(needId,result)` | in_progress→delivered、result 保存 | 未 in_progress 即交付 | integration | P0 | ✅ |
| SOCIETY-002-009 | `acceptDelivery(needId)` | delivered→closed、声誉+、relationship 累积 | 非 delivered 审核 | integration | P0 | ✅ |
| SOCIETY-002-010 | `cancelNeed` | open/assigned→cancelled，从 active 移除 | 已 in_progress 仍可取消 | unit | P1 | ✅ |
| SOCIETY-002-011 | `requestRevision` | delivered→assigned、revisionCount+1 | revisionCount 不递增 | unit | P1 | ✅ routes（revision 路由） |
| SOCIETY-002-012 | `transitionNeed` 非法跳变护栏 | 返回业务错误（如 `Invalid need transition`），不静默改 | 静默允许非法跳变 | unit | **P0** | ✅ policies |
| SOCIETY-002-013 | 已 closed 重复 accept | 幂等/拒绝（不重复加声誉） | 声誉重复累加 | unit | P1 | ✅ |
| SOCIETY-002-014 | `expireNeeds` 超时 | open/assigned/in_progress/delivered 超时→expired | 仍停留 | unit | P1 | ✅ service（expireNeeds） |
| SOCIETY-002-015 | 优先级 priority 排序 | `sortNeedsByLifecycle` 同阶段内高优先先 | 顺序错 | unit | P1 | ✅ viewUtils |
| SOCIETY-002-016 | activeNeeds 只含 4 态 | closed/expired/cancelled 不出现在 board/graph | 串档 | unit | P0 | ✅ graphAdapter |

- **风险点**：状态机非法跳变必须返回业务错误（ok:false），非 5xx；并发 accept 造成声誉重复累加。

---

## 3. SOCIETY-003 · 去中心化自治（autonomousVolunteers + autoSelect）

**文件**：`societyPolicies.ts`（`autonomousVolunteers`、`computeFitScore`、`canVolunteer`、`isAtCapacity`）、`WorkerSocietyService.ts`（`runAutonomyTick`、`autoSelectPending`）

| ID | 场景 | 验收通过 | 验收失败 | 类型 | 优先级 | 现有测试 |
|---|---|---|---|---|---|---|
| SOCIETY-003-001 | `autonomousVolunteers`：能力匹配的 worker 自荐 | 仅匹配+在线+未满+未自荐者自荐 | 全员自荐/能力不符也自荐 | unit | P0 | ✅ policies |
| SOCIETY-003-002 | 贪婪按 FitScore desc | 高分优先占额度 | 顺序错 | unit | P0 | ✅ |
| SOCIETY-003-003 | `maxVolunteersPerNeed`（默认 3）配额 | 单 need 自荐不超过上限 | 超额 | unit | P0 | ✅ |
| SOCIETY-003-004 | `maxNeedsPerWorker`（默认 1）配额 | 单 worker 同时自荐不超过上限（计入已有自荐） | 超额 | unit | P0 | ✅ |
| SOCIETY-003-005 | `isAtCapacity` / `canVolunteer` 守卫 | 已满/离线/已自荐者被排除 | 仍参与 | unit | P1 | ✅ |
| SOCIETY-003-006 | `runAutonomyTick(opts)` 经 volunteerFor 落地 | 返回 applied 数；自荐真正写入 need.volunteers | 只算不写 | integration | P0 | ✅ service + mcp + routes |
| SOCIETY-003-007 | `autoSelectPending` 择优 | 对每个有自荐者的 open need 选最佳 → assigned | 无自荐者也选 | integration | P0 | ✅ |
| SOCIETY-003-008 | `computeFitScore` 五维加权 | 能力+负载公平+声誉+关系+兴趣加权正确 | 某维漏算/权重错 | unit | P0 | ✅ policies |
| SOCIETY-003-009 | tick→autoSelect 一键闭环 | 「触发自治」后 open→assigned 链路成立 | 断链 | integration | P0 | ✅ service |
| SOCIETY-003-010 | tick 后重载 open-needs + feed | UI/store 刷新看到新状态 | 不刷新 | integration | P1 | ✅ store |

- **风险点**：配额计数必须包含 pre-existing 自荐者，否则超额；贪婪顺序影响公平性。

---

## 4. SOCIETY-004 · 声誉与关系累积

**文件**：`societyPolicies.ts`（`applyReputationDelta`、`reputationDeltaForOutcome`、`recordCollaboration`）、`WorkerSocietyService.ts`（`recordCollaboration`、`getRelationships`）

| ID | 场景 | 验收通过 | 验收失败 | 类型 | 优先级 | 现有测试 |
|---|---|---|---|---|---|---|
| SOCIETY-004-001 | 成功协作 → `reputationDeltaForOutcome` 正分 | 成功给正 delta | 给负/0 | unit | P0 | ✅ policies |
| SOCIETY-004-002 | 失败/驳回 → 负分 | revision/failure 给负 delta | 给正 | unit | P0 | ✅ |
| SOCIETY-003 | `applyReputationDelta` 边界 | 声誉 clamp 到 [0,100] | 越界/NaN | unit | P1 | ✅ |
| SOCIETY-004-004 | `recordCollaboration` | collaborations+1、trust 更新、lastInteractedAt 刷新 | 不递增 | integration | P0 | ✅ service + routes |
| SOCIETY-004-005 | 有向关系（from→to） | 方向保留、可查双向 | 方向丢 | unit | P1 | ✅ |
| SOCIETY-004-006 | 闭环 accept 后关系累积 | need closed 时 from(assignee)→to(poster) 关系+1 | 未累积 | integration | P0 | ✅ routes（relationships after collaboration） |
| SOCIETY-004-007 | `reputationColor` 映射 | 高=绿/中=橙/低=红 | 颜色错 | unit | P2 | ✅ viewUtils |
| SOCIETY-004-008 | `workerNodeRadius` = 声誉 | 0→min、100→max、clamp | 越界 | unit | P2 | ✅ viewUtils |

- **风险点**：声誉 clamp；关系方向；revision 不应给正分。

---

## 5. SOCIETY-005 · 社交消息与 Feed（跨团队格式化）

**文件**：`WorkerSocietyService.ts`（`sendSocialMessage`）、`main/infrastructure/crossTeamMessageGateway.ts`、`societyRoutes.ts`（`/messages`、`/feed`）

| ID | 场景 | 验收通过 | 验收失败 | 类型 | 优先级 | 现有测试 |
|---|---|---|---|---|---|---|
| SOCIETY-005-001 | `sendSocialMessage(from,to,text)` | 落盘、feed 可查 | 丢 | integration | P0 | ✅ |
| SOCIETY-005-002 | 经 `formatCrossTeamText` 格式化 | 消息带跨团队标记/格式正确 | 原样未格式化 | integration | P1 | ✅ gateway |
| SOCIETY-005-003 | `getFeed` 返回记录 | 含 id/from/to/text/createdAt | 缺字段 | unit | P1 | ✅ |
| SOCIETY-005-004 | feed 时序 | 按 createdAt 排序（UI .reverse() 倒序最新在上） | 乱序 | unit | P2 | ⚠️ store/view 倒序逻辑未单测 |
| SOCIETY-005-005 | 收件人不存在 | 降级/安全返回不崩 | 崩 | unit | P1 | ⚠️ 边界未明确测 |

- **风险点**：跨团队文本格式化须复用 hermit `formatCrossTeamText`，不可自造。

---

## 6. SOCIETY-006 · 图谱投影（societyGraphAdapter，纯函数）

**文件**：`renderer/societyGraphAdapter.ts`（`projectSocietyGraph`）

| ID | 场景 | 验收通过 | 验收失败 | 类型 | 优先级 | 现有测试 |
|---|---|---|---|---|---|---|
| SOCIETY-006-001 | 空社会 | nodes/edges/particles 全空、isAlive=false | 残留 agora | unit | P1 | ✅ |
| SOCIETY-006-002 | 合成 Agora hub 居中 | kind=lead、每个 worker parent-child 连 agora | 无 hub | unit | P0 | ✅ |
| SOCIETY-006-003 | worker→member 节点状态 | idle（空闲）/active（有任务或 busy）/offline 仍可见 | 状态错 | unit | P0 | ✅ |
| SOCIETY-006-004 | in_progress need→task+粒子 | task state=active、ownership 边、cyan 粒子 progress=0 | 缺粒子/边 | unit | P0 | ✅ |
| SOCIETY-006-005 | open need→waiting、无 owner 边/无粒子 | ownerId=null | 误给边 | unit | P1 | ✅ |
| SOCIETY-006-006 | delivered→complete、无粒子 | taskStatus=completed | 仍有粒子 | unit | P1 | ✅ |
| SOCIETY-006-007 | closed/expired/cancelled 丢弃 | 无 task 节点 | 残留 | unit | P0 | ✅ |
| SOCIETY-006-008 | relationship→related 边双向去重 | 双向只一条 | 重复 | unit | P1 | ✅ |
| SOCIETY-006-009 | 引用未知 worker 的 relationship 跳过 | 无悬空边 | 悬空边 | unit | P1 | ✅ |
| SOCIETY-006-010 | assignee 指向未注册 worker | ownerId=null、无 ownership 边/无粒子（孤儿任务） | 悬空边/崩 | unit | P1 | ✅（iter-1 补） |
| SOCIETY-006-011 | 径向 layout ownerOrder=worker 节点 id | mode=radial、owner 全有对应 member | 缺 | unit | P2 | ✅ |
| SOCIETY-006-012 | 确定性（无 random） | 相同输入→相同输出 | 不确定 | unit | P0 | ✅ |
| SOCIETY-006-013 | resolveAvatarUrl 注入 | worker 节点带 avatar、hub 无 avatar | 全空/全给 | unit | P1 | ✅ |
| SOCIETY-006-014 | 每个 in-flight need 恰一粒子 | 多 need 各一、无 assignee 无粒子 | 重复/漏 | unit | P1 | ✅ |

---

## 7. SOCIETY-007 · 渲染层视图工具（societyViewUtils，纯函数）

**文件**：`renderer/societyViewUtils.ts`

| ID | 场景 | 验收通过 | 验收失败 | 类型 | 优先级 | 现有测试 |
|---|---|---|---|---|---|---|
| SOCIETY-007-001 | `activeWorkers` | online/busy 或有 activeTask 保留；offline 空闲移除 | 误留/误删 | unit | P1 | ✅ |
| SOCIETY-007-002 | `pickAvatarUrl` 稳定映射 | 同 id→同 url、空集→undefined、分布不塌缩 | 不确定 | unit | P0 | ✅ |
| SOCIETY-007-003 | `edgeWidth` [1,8] clamp | 0→1、4→4、超→8 | 越界 | unit | P2 | ✅ |
| SOCIETY-007-004 | `trustOpacity` 0→0.2..1→1 | 线性 | 错 | unit | P2 | ✅ |
| SOCIETY-007-005 | `needStatusColor` 7 态全异色 | Set size=7 | 重复色 | unit | P2 | ✅ |
| SOCIETY-007-006 | `sortNeedsByLifecycle` 不 mutate | 输入不变 | 改原数组 | unit | P1 | ✅ |

---

## 8. SOCIETY-008 · REST API 契约（Fastify `/api/society/*`）

**文件**：`main/adapters/input/societyRoutes.ts`（19 路由）

| ID | 场景 | 验收通过 | 验收失败 | 类型 | 优先级 | 现有测试 |
|---|---|---|---|---|---|---|
| SOCIETY-008-001 | GET /workers 起始为空 | `[]` | 崩 | integration | P0 | ✅ |
| SOCIETY-008-002 | POST /workers/register | 注册后可 list | 失败 | integration | P0 | ✅ |
| SOCIETY-008-003 | POST /needs | 发布为 open | 状态错 | integration | P0 | ✅ |
| SOCIETY-008-004 | volunteer→select→start→deliver→accept 全链路 | need closed | 断链 | integration | P0 | ✅ |
| SOCIETY-008-005 | POST /autonomy/tick | 匹配 worker 自荐、返回 applied | 不自荐 | integration | P0 | ✅ |
| SOCIETY-008-006 | POST /autonomy/auto-select | 择优 assigned | 无 | integration | P0 | ✅ |
| SOCIETY-008-007 | GET /feed 跨团队格式化 | 带格式文本 | 原样 | integration | P1 | ✅ |
| SOCIETY-008-008 | GET /relationships 协作后 | 含累积关系 | 空 | integration | P1 | ✅ |
| SOCIETY-008-009 | cancel / revision 路由 | cancelled / revisionCount+1 | 失败 | integration | P1 | ✅ |
| SOCIETY-008-010 | 非法状态跳变 | 200 + ok:false 业务错误（非 5xx） | 5xx/静默 | integration | **P0** | ✅ |
| SOCIETY-008-011 | GET /needs/open vs /active vs / | 各自过滤正确 | 串档 | integration | P0 | ✅ |

- **判定规则**（与 hermit 全局一致）：业务错误返回 HTTP 200 + `{ok:false,error}`，状态机非法跳变不抛 5xx。

---

## 9. SOCIETY-009 · MCP 工具暴露（`society_*`，13 个）

**文件**：`main/adapters/input/societyMcp.ts`、`/mcp` 端点（`SOCIETY_MCP_TOOLS`）

工具集：`society_register_worker`、`society_discover_workers`、`society_list_open_needs`、`society_publish_need`、`society_volunteer`、`society_select_assignee`、`society_start_need`、`society_deliver_need`、`society_accept_delivery`、`society_run_autonomy_tick`、`society_auto_select`、`society_message_worker`、`society_get_feed`。

| ID | 场景 | 验收通过 | 验收失败 | 类型 | 优先级 | 现有测试 |
|---|---|---|---|---|---|---|
| SOCIETY-009-001 | `/mcp tools/list` 含全部 13 个 society_* | 数量+命名完整 | 缺 | integration | P0 | ✅ mcp（namespaced tool list） |
| SOCIETY-009-002 | schema 校验后执行 | 符合 schema 才执行、返回正确格式 | 非法也执行 | integration | P0 | ✅ |
| SOCIETY-009-003 | register→discover 闭环 | 注册后可按能力发现 | 发现失败 | integration | P1 | ✅ |
| SOCIETY-009-004 | 全自治闭环经 MCP | publish→tick→auto_select→start→deliver→accept→closed | 断链 | integration | P0 | ✅ |
| SOCIETY-009-005 | society_run_autonomy_tick | 匹配 worker 自荐 | 不自荐 | integration | P1 | ✅ |
| SOCIETY-009-006 | society_auto_select | 择优 assigned | 无 | integration | P1 | ✅ |

---

## 10. SOCIETY-010 · 可安装插件（`openhermit add worker-society`）

**文件**：`main/composition/workerSocietyPlugin.ts`、`bin/hermit.mjs`（`add <plugin>`）

| ID | 场景 | 验收通过 | 验收失败 | 类型 | 优先级 | 现有测试 |
|---|---|---|---|---|---|---|
| SOCIETY-010-001 | 描述符 id/SSE 端点/工具名 | 端点指向 `/mcp`、工具名实时取自 SOCIETY_MCP_TOOLS | 写死/错 | unit | P0 | ✅ plugin（7 测试） |
| SOCIETY-010-002 | `buildWorkerSocietyMcpLibraryEntry` | 契约匹配 `McpLibraryService.upsert` | 字段不匹配 | unit | P0 | ✅ |
| SOCIETY-010-003 | `openhermit add worker-society` POST /api/extensions/mcp/library | 落 `~/.hermit/mcp-library.json` | 失败 | e2e | P1 | ⚠️ 端到端已人工验证、无自动化 |
| SOCIETY-010-004 | 重复 add 幂等 | 报「already in library」而非崩 | 崩/重复 | e2e | P1 | ⚠️ 人工验证 |
| SOCIETY-010-005 | KNOWN_PLUGINS 初始化时序 | add 检查在 runAddPlugin 定义之后 | 时序崩 | integration | P1 | ⚠️ 人工验证 |

- **许可**：agent-teams-ai 为 AGPL-3.0，复用其引擎有许可影响（本插件仅复用 hermit 已 vendor 的 `packages/agent-graph`，非新引入）。

---

## 11. SOCIETY-011 · 持久化与文件系统（FsStores）

**文件**：`main/infrastructure/fsStores.ts`（`~/.hermit/society/`）

| ID | 场景 | 验收通过 | 验收失败 | 类型 | 优先级 | 现有测试 |
|---|---|---|---|---|---|---|
| SOCIETY-011-001 | FsProfileStore missing → undefined | 不抛 | 抛 | unit | P1 | ✅ |
| SOCIETY-011-002 | list all profiles | 返回全部 | 漏 | integration | P1 | ✅ |
| SOCIETY-011-003 | delete profile | 移除 | 残留 | integration | P1 | ✅ |
| SOCIETY-011-004 | 跨实例重载（new 实例读盘） | 数据一致 | 丢 | integration | P0 | ✅ profile + need |
| SOCIETY-011-005 | FsNeedStore 持久化 | need 落盘可读 | 丢 | integration | P0 | ✅ |

---

## 12. SOCIETY-012 · 组合根与渲染挂载

**文件**：`main/composition/societyComposition.ts`（`createWorkerSociety`）、`renderer/societyApi.ts`、`societyStore.ts`、`SocietyGraph.tsx`、`SocietyView.tsx`

| ID | 场景 | 验收通过 | 验收失败 | 类型 | 优先级 | 现有测试 |
|---|---|---|---|---|---|---|
| SOCIETY-012-001 | createWorkerSociety 装配全链路 | 模拟重启后数据一致 | 不一致 | integration | P0 | ✅ composition（2 测试） |
| SOCIETY-012-002 | societyApi.parseResponse 非 2xx | 抛 {error} | 静默 | unit | P1 | ✅ societyApi |
| SOCIETY-012-003 | societyApi 空体 2xx | 返回 undefined | 崩 | unit | P1 | ✅ |
| SOCIETY-012-004 | 能力逗号串 → 数组 | 正确切分 | 不切 | unit | P1 | ✅ |
| SOCIETY-012-005 | store actions 触发后重载 | mutate→reloadWorkers 刷新 | 不刷新 | unit | P0 | ✅ societyStore |
| SOCIETY-012-006 | SocietyGraph 全屏（onRequestFullscreen） | createPortal overlay、body 滚动锁 | 无 | e2e | P2 | ❌ UI 未测 |
| SOCIETY-012-007 | 空社会引导层 + CTA | nodes=0 显示「社会尚未启动」+「去添加成员」 | 空白 | e2e | P2 | ❌ UI 未测 |
| SOCIETY-012-008 | 图谱全屏铺满 pane（iter-本次） | canvas 去掉 padding/header 挤占、工具条浮于其上 | 仍偏小 | manual | P1 | ❌ 需人工/截图 |
| SOCIETY-012-009 | 实时性：生命周期操作后重投影 | 触发自治/自荐/选派后节点状态/粒子实时更新 | 不更新 | manual | P1 | ⚠️ 数据流已测、视觉未测 |

---

## 13. 端到端闭环（黄金路径）

**SCENE-E2E-001 · 一键自治全闭环**（覆盖 SOCIETY-002 + 003 + 004 + 008 + 009）

```
1. 注册 3 个 worker（capabilities: code / review / code+review）
2. 发布 2 个 need（所需能力 code、review）
3. 「触发自治」→ tick: 匹配 worker 自荐 → autoSelect: 择优 assigned
4. startNeed → deliverNeed → acceptDelivery
5. 断言：need closed；assignee 声誉上升；from→to relationship collaborations+1；
        /api/society/feed 含跨团队格式化消息；/mcp tools/list 含 13 个 society_*。
```
- **验收通过**：全链路无断点、状态/声誉/关系/feed 全部正确。
- **验收失败**：任一环节状态未推进 / 声誉未变 / 关系未累积 / feed 缺。
- **类型**：integration（已有自动化覆盖，见 `societyComposition.test.ts`、`societyRoutes.test.ts`、`societyMcp.test.ts`）。

---

## 14. 覆盖地图 / 缺口 / 补测优先级

### 14.1 现状
- **13 文件 / 213 用例 / 全绿**。领域策略、应用服务、REST、MCP、持久化、组合根、图谱投影、视图工具覆盖**充分**。
- 渲染层纯逻辑（adapter/utils/api/store）已测；**React 组件挂载（SocietyGraph/SocietyView）未测**（hermit 未引入 @testing-library/react）。

### 14.2 缺口（❌ 必补 / ⚠️ 部分）
| 缺口 | 用例 | 建议 |
|---|---|---|
| React 组件渲染 | SOCIETY-012-006/007/008/009 | 引入 @testing-library/react 或用 playwright e2e |
| 插件安装端到端自动化 | SOCIETY-010-003/004/005 | 用 Fastify inject + 临时 HOME 脚本化 |
| feed 倒序单测 | SOCIETY-005-004 | 在 societyStore/view 补 |
| 收件人不存在边界 | SOCIETY-005-005 | service 补 |
| 视觉验收（全屏铺满/实时重投影） | SOCIETY-012-008/009 | 人工 + 截图（依赖运行 app） |

### 14.3 回归红线（一旦破坏即阻塞）
- **状态机非法跳变必须返回业务错误**（SOCIETY-002-012 / 008-010）。
- **声誉 clamp [0,100]、不可重复累加**（SOCIETY-004-003/013）。
- **配额计数含 pre-existing 自荐者**（SOCIETY-003-003/004）。
- **图谱投影确定性**（SOCIETY-006-012）。
- **avatar 稳定映射**（SOCIETY-007-002）。

---

## 15. 产品验收记录（迭代日志）

> 本节是「作为产品体验去验收」的活日志。每轮（30 分钟循环 `660d58c4`）追加一条：自动化结论 + 逐域产品验收 + 意见 + 本轮迭代动作。引用用例 ID。

### 迭代 #1 · 2026-06-14
**自动化基线**：`vitest run src/features/worker-society` → **207/207 全绿**（12 文件）；`tsc` worker-society 干净（ClaudeDoctorProbe 基线除外）。

| 域 | 结论 | 产品意见 |
|---|---|---|
| SOCIETY-001 worker 注册 | ✅ PASS | 注册表单可用；缺「一键示例」冷启动入口（本轮补） |
| SOCIETY-002 Need 生命周期 | ✅ PASS | open→assigned→in_progress→delivered→closed 闭环可走通 |
| SOCIETY-003 自治 | ✅ PASS | 「触发自治」tick+autoSelect 一键有效 |
| SOCIETY-004 声誉/关系 | ✅ PASS | 协作后累积；但 UI 未直观呈现「为何涨」 |
| SOCIETY-005 消息/Feed | ⚠️ 部分 | feed 倒序/收件人边界未单测；UI 消息较朴素 |
| SOCIETY-006 图谱投影 | ✅ PASS | 15 用例确定性覆盖；孤儿 assignee 已护 |
| SOCIETY-007 视图工具 | ✅ PASS | 纯函数全覆盖 |
| SOCIETY-008 REST | ✅ PASS | 19 路由 + 非法跳变业务错误 |
| SOCIETY-009 MCP | ✅ PASS | 13 工具闭环 |
| SOCIETY-010 插件安装 | ⚠️ 部分 | unit 全绿；e2e 仅人工 |
| SOCIETY-011 持久化 | ✅ PASS | 跨实例重载一致 |
| SOCIETY-012 组合根/挂载 | ⚠️ 部分 | 逻辑全绿；React 组件 UI 无自动化；全屏铺满已上（视觉待人工确认） |

**产品意见（按优先级）**：
1. **冷启动/可演示性**：空社会需手工逐个注册，演示成本高 → 本轮加「加载示例社会」一键播种。
2. **历史不可见**：closed/expired/cancelled 的 need 从看板/图谱彻底消失，看不到过往协作 → 下一轮补「历史」视图（`listAllNeeds` 已就绪，缺 UI）。
3. **节点点击无反馈**：图谱点 worker → 死的 Message 按钮（`onSendMessage` 未接）→ 后续接 `renderOverlay`。
4. **声誉归因**：声誉变化无解释/趋势 → 后续补 tooltip/趋势。

**本轮迭代动作**：新增 `renderer/societyDemo.ts`（`buildDemoSociety()` 纯函数 + 测试，TDD）；空状态引导层加「加载示例社会」按钮 → 一键注册 3 worker + 发布 2 need，使社会即时可演示。

**下一轮候选**：历史视图（意见 #2）。

---

### 迭代 #2 · 2026-06-14
**自动化基线**：`vitest run src/features/worker-society` → **225/225 全绿**（14 文件，较 iter-1 的 207 +18）；`tsc` exit 0（worker-society 干净，ClaudeDoctorProbe 基线本轮亦清零）。

**本轮产品主张：纯图谱（图谱即界面）。** 用户反馈「看板真的好丑好丑，要不删除了，所有的交互都在图谱中」→ 删掉看板与图谱/看板切换，整页只剩全息图谱，所有交互都在图谱里。

| 域 | 结论 | 产品意见 |
|---|---|---|
| SOCIETY-001 worker 注册 | ✅ PASS | 注册入口移到顶部「＋注册」小弹层（点开即填），不再占看板列 |
| SOCIETY-002 Need 生命周期 | ✅ PASS(逻辑) | **点 need 节点 → 弹卡按状态出生命周期动作**（assigned→开始执行 / in_progress→标记交付 / delivered→通过审核），闭环可全程在图谱内推进；自荐改由「触发自治」自动完成（反派单），open need 有自荐者时弹卡多出「选派最优」 |
| SOCIETY-003 自治 | ✅ PASS | 「触发自治」仍在顶栏；need 弹卡 open 态也内嵌「触发自治」入口 |
| SOCIETY-004 声誉/关系 | ✅ PASS | 声誉=节点大小、关系=发光边，去掉文字排行榜/关系列表后界面更干净；信息无损 |
| SOCIETY-005 消息/Feed | ✅ PASS(逻辑) | **点 worker 节点 → 弹卡「发消息」已接通**（人→worker，from='user'），解决 iter-1 意见 #3「节点点击无反馈」；Feed 文字列表移除（图谱沿边粒子 + 弹卡已表达在途交互） |
| SOCIETY-006 图谱投影 | ✅ PASS | adapter 未动，15 用例不变 |
| SOCIETY-007 视图工具 | ✅ PASS | 新增 `NEED_STATUS_LABEL` 单一来源；societyViewUtils 全覆盖 |
| SOCIETY-008 REST | ✅ PASS | 未动 |
| SOCIETY-009 MCP | ✅ PASS | 未动 |
| SOCIETY-010 插件安装 | ⚠️ 部分 | 同 iter-1 |
| SOCIETY-011 持久化 | ✅ PASS | 未动 |
| SOCIETY-012 组合根/挂载 | ⚠️ 部分 | **纯图谱交互落地**：删看板+切换、删 NeedCard/WorkerNode/RelationshipRow/FeedItem；新增 `SocietyNodeOverlay`（点节点弹卡，member→发消息 / task→生命周期 / lead→概览）+ 顶栏 `PublishPopover`/`RegisterPopover`；`SocietyGraph` 透传 `renderOverlay` 到引擎两处 mount。React 组件 UI 仍无自动化（已知缺口），但交互面已全部接通 store 动作 |

**新增纯逻辑（TDD，12 测试）**：`renderer/societyOverlayActions.ts` —— `needLifecycleActions(status, hasVolunteers)` 决定 need 弹卡的动作集（纯图谱交互模型的全部决策点）+ `clampOverlayPosition(pos, viewport, size)` 保证弹卡不被屏幕边缘裁切（右侧溢出翻左、上下夹紧）。

**产品意见（按优先级）**：
1. **弹卡视觉确认**：弹卡定位用固定尺寸估算 + clamp，逻辑已测；但极端视口/节点贴边时的实际渲染需人工截图确认（无 UI 自动化）。
2. **历史不可见**（iter-1 意见 #2 未决）：closed/expired/cancelled 的 need 仍从图谱消失 → 下一轮补历史视图。
3. **声誉归因**（iter-1 意见 #4 未决）：节点大小变了但无解释 → 后续补 tooltip/趋势。
4. **键盘可达性**：弹卡无 Esc 关闭、Tab 焦点未管理 → 后续补。

**本轮迭代动作**：删看板 + 图谱/看板切换（SocietyView 605→~410 行）；新增 `SocietyNodeOverlay.tsx` + `societyOverlayActions.ts`(+test)；`SocietyGraph` 透传 `renderOverlay`；SocietyView 重写为图谱单视图 + 顶栏 `＋发布`/`＋注册` 弹层 + 节点弹卡接通全部生命周期/消息 store 动作。225/225 绿，tsc exit 0。

**下一轮候选**：历史视图（意见 #2）；弹卡视觉人工确认（意见 #1）。

---

### 迭代 #3 · 2026-06-14（10 分钟 TDD 覆盖循环 #1e539b60）
**自动化基线**：`vitest run src/features/worker-society` → **226/226 全绿**（14 文件，较 iter-2 的 225 +1）；`tsc` exit 0。

**本轮聚焦缺口（一个，TDD 红→绿）**：`main/infrastructure/crossTeamMessageGateway.ts` 的 `all()` —— append-only JSONL，若 `messages.jsonl` 混入一行损坏/半行（append 中途崩溃的残留），旧实现 `JSON.parse(line)` 抛错 → 外层 catch → **整个 feed 返回 `[]`，静默全量丢失**。`filter(l=>l.trim())` 只挡空行、不挡坏 JSON。属 CLAUDE.md 点名的 JSONL 健壮性回归类（hermit 自身 session reader 亦容忍坏行）。

| 域 | 结论 | 产品意见 |
|---|---|---|
| SOCIETY-005 消息/Feed | ✅ PASS(加固) | 坏行不再抹掉 feed；崩溃后重启仍能读到崩溃前的合法消息 |

**TDD 痕迹**：先在 `crossTeamMessageGateway.test.ts` 加「tolerates a corrupt/partial line」用例（手写坏行入 messages.jsonl）→ **红**（`recent(50)` 返回 `[]` 而非 `['keep-1','keep-2']`）→ 改 `all()` 为逐行 try/catch 跳过坏行 → **绿**。文件缺失仍返回 `[]`（外层 catch 不变），合法行顺序不变。

**审查中排除的「假缺口」**（已测/已定约，避免误改）：
- `recent(n)` 返回「最后 n 条按发送顺序」——`test.ts:55-61` 已显式定约（oldest-first，非 bug）。
- `societyStore.cancelNeed`、`parseResponse` 非 JSON 错误分支——已实现正确，补测属 characterization（非红），留作后续补全。

**本轮迭代动作**：`crossTeamMessageGateway.ts` `all()` 逐行容错（红→绿，+1 测试）；226/226 绿，tsc exit 0。

**下一轮候选**：① 补 characterization 测试（store mutation 失败契约 / cancelNeed / parseResponse 非 JSON 错误体）以达「最全」；② 历史视图（iter-1 意见 #2）；③ `recent(0)` 当前返回全量（`slice(-0)===slice(0)`）——边界 bug，待评估是否需修。

---
```bash
# 全量（worker-society 独立）
node_modules/.bin/vitest run src/features/worker-society
# 单域速查
node_modules/.bin/vitest run src/features/worker-society/core/domain/policies/societyPolicies.test.ts
node_modules/.bin/vitest run src/features/worker-society/main/adapters/input/societyRoutes.test.ts
# 类型（过滤环境基线 ClaudeDoctorProbe）
node_modules/.bin/tsc -p . 2>&1 | grep worker-society
# web 形态冒烟（黄金路径）
pnpm dev:server & pnpm dev:web &
curl -s http://127.0.0.1:5680/api/society/workers
curl -s -XPOST http://127.0.0.1:5680/api/society/autonomy/tick
```
