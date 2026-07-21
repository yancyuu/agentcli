# Code Review: 任务生命周期 & 团队消息路由

审查范围:`TaskDispatchService.ts`、`CollaborationBoardService.ts`、`externalPlatformSessionRouting.ts`、`externalPlatformSessionKey.ts`、`teamProjectResolution.ts`、`server.ts` dispatch/platformAllowFrom/feishu 路由相关段落。

测试状态:`TaskDispatchService.test.ts` (15) + `externalPlatformSessionKey.test.ts` (4) 全部通过。但测试仅覆盖 local 双团队同进程场景,远程跨机路径无任何测试覆盖。

---

## 严重 (High)

### 1. 自动审批(`needsHumanReview: false`)永远不触发 —— 双重死代码

【TaskDispatchService.ts:1283-1320 (`applyResponse`);598-623 (`deliverTask`)】

**问题:** `applyResponse` 里的自动审批分支有两层不可达:
- (a) **第 1285 行 `if (!shadowTask) return`** —— `applyResponse` 在 `originTeam`(`response.toTeam`)的任务列表里找 `dispatchMeta.dispatchId` 匹配的 shadow task,但 `dispatchTask` 流程**只在 target 团队创建本地任务**(`createOrReuseReceivedTask(targetTeam, …)`),从不在 origin 创建。全代码库无任何位置为 origin 创建 shadow task(已 grep 确认)。因此 `shadowTask` 恒为 `undefined`,函数提前返回,自动审批分支(1308-1320)永远到不了。
- (b) **即便不提前返回**:`deliverTask` 第 598 行先调 `handleLocalResponse(response)`(→ `applyResponse`),第 608 行**之后**才 `collabBoard.transition(… next: 'delivered')`。`applyResponse` 执行时 collabBoard.status 还是 `'in_progress'`,第 1308 行 `collabTask.status === 'delivered'` 恒为 `false`。

**触发条件:** 任何 `needsHumanReview: false` 的跨团队任务在 target 交付后。

**后果:** 任务永久卡在 `'delivered'`,等待永远不会到来的自动审批,必须人工手动 `approve_task`。用户配置"免审核"却得不到免审核行为。

**建议修法:** 将自动审批逻辑移入 `deliverTask`,放在第 608 行 `transition(… 'delivered')` **之后**:
```ts
const deliveredTask = this.collabBoard.transition({ … next: 'delivered' … });
if (!collabTask.needsHumanReview) {
  this.collabBoard.transition({ dispatchId, expected: 'delivered', next: 'approved', … });
  // 并补发 origin/target 通知
}
```
同时删除 `applyResponse` 中已失效的自动审批分支。

---

### 2. `sendFeishuNotification` 硬编码飞书 chat_id

【TaskDispatchService.ts:896-918,关键行 907】

**问题:** 所有跨团队状态通知(dispatch / accept / reject / deliver / approve / rejectResult 共 6 处调用)全部发送到同一个硬编码 chat_id `oc_e7d4204895f8f9d763d9f0e42ead1e5e`,与实际涉及的团队无关。且通过 `execFileSync('feishu-cli', …)` 同步 fork 子进程,`feishu-cli` 不存在时静默 catch 丢弃。

**触发条件:** 任何跨团队任务状态变更触发通知。

**后果:** 多团队环境下所有通知涌入同一个聊天(疑似开发/测试遗留值);`feishu-cli` 未安装时所有通知静默丢失,无日志。

**建议修法:** 从团队 manifest 的 `platformAllowChat` 读取目标 chat;或复用 `sendHarnessMessageViaBridge` 走 hermit-bridge 既有通道;移除硬编码 ID 与同步 fork。

---

## 中等 (Medium)

### 3. 远程跨团队交付响应在发起方被静默丢弃

【TaskDispatchService.ts:1283-1285 (`applyResponse`);1368-1382 (`handleStatusSync`)】

**问题:** `applyResponse`(处理 deliver/accept/reject 响应)与 `handleStatusSync`(处理完成状态 pub/sub)都依赖 `workspace.readTasks(originTeam)` 找到 shadow task。但 dispatch 流程从不在 origin 创建 shadow task(见 #1)。远程模式下,origin 机器的 response consumer 收到 target 的 `task_deliver` 响应时找不到 shadow task → `return`,origin 的 collabBoard 永远停留在 `'received'`。

**触发条件:** 远程团队(不同机器)交付任务结果时,origin 侧处理响应。

**后果:** 发起方 UI 永远显示 `'received'`;远程场景下 origin 对 delivered/approved 状态完全无感知;collabBoard 的 Redis 同步(`syncTaskToRedis`)只在每次 transition 时写,但 origin 只在启动时 `syncFromRedis` 一次,运行期不拉取。

**建议修法:** 二选一:(a) `dispatchTask` 时在 origin 也创建 shadow task(记录 dispatchMeta);(b) origin 的 collabBoard 通过 Redis keyspace 通知 / 周期 `syncFromRedis` 保持活同步。

---

### 4. `subscribeStatus` 不为启动后新建的团队订阅状态通道

【TaskDispatchService.ts:1343-1361】

**问题:** `subscribeStatus` 只在 `connectRedis` 时调用一次,读取当时的 `listTeams()` 并 `subscribe('task:status:{slug}')`。dispatch/response consumer 有 10s 周期的 `buildTeamSync` 来发现新团队(第 1187 行),但 **status pub/sub 没有周期发现机制**。

**触发条件:** 服务启动后新建团队,该团队后续作为 origin 接收远程 target 的完成通知。

**后果:** 新团队的 `task:status:` 通道从未被 subscribe,远程完成状态更新被 Redis 静默丢弃。

**建议修法:** 复用 `buildTeamSync` 的周期发现,对新增团队主动 subscribe;或在 `updateTeam`/`createTeam` 时触发增量 subscribe。

---

### 5. `checkDeadlines` 造成状态不一致 + 孤儿 `pendingRequests`

【TaskDispatchService.ts:1026-1051】

**问题:** 超时检测只 `patchTask` 本地 task 的 `dispatchMeta.status = 'failed'`(`rejectionReason: 'handshake timeout'`),但:
- 不更新 collabBoard(仍 `'received'`)→ 本地 task 与 collabBoard 状态不一致;
- 不清理 `pendingRequests` → 条目残留;
- 不通知 origin(无 `appendMessage`、无 Redis publish);
- 不发飞书通知。

**触发条件:** 跨团队任务带 `deadline` 且超时未启动(由 30s heartbeat 触发)。

**后果:** 用户在 UI(collabBoard)仍见 `'received'` 但实际已 failed;点 Start 会被 `startDispatchedTaskLocked` 拒绝(`'failed'` 不在 `['received','pending_accept','accepted']` 内,第 357 行);pendingRequests 条目泄漏。

**建议修法:** 超时时同步 `collabBoard.transition({ expected:['received','pending_accept'], next:'failed' …})`,清理 `pendingRequests`,通知 origin(`appendMessage` + 状态 publish)。

---

### 6. 进程重启后 Redis 已分发但未 ACK 的消息成为孤儿

【TaskDispatchService.ts:1053-1101 (`startConsumers`);1110-1180 (`handleIncomingDispatch`)】

**问题:** consumer 用 `XREADGROUP … '>'` 只读**新**消息。`handleIncomingDispatch` 收到后不立即 ACK(等 `startDispatchedTask` / `rejectTask` 才 `xack`)。进程重启后 in-memory `pendingRequests` 丢失,PEL(Pending Entries List)中的未 ACK 条目永远不会被 `'>'` 重新投递。重启后:
- `acceptTask` / `rejectTask` 因 `pendingRequests` 为空而抛 `"No pending request found"`;
- dispatch 消息永久滞留 PEL。

**触发条件:** 收到 dispatch 后、用户 Start/Reject 前进程重启。

**后果:** 任务卡在 PEL 永不处理;accept/reject 不可用。(`startDispatchedTask` 按 taskId 查本地 task 仍可工作,但不走 pendingRequests 路径。)

**建议修法:** 启动时用 `XAUTOCLAIM` 或 `XREADGROUP … '0'` 回收本 consumer 的 PEL 条目,重建 `pendingRequests`。

---

## 低 / 观察 (Low / Note)

### 7. consumer 每轮只处理 1 条消息 + 5s 间隔 → 积压排空极慢

【TaskDispatchService.ts:1075-1099;1225-1249】

**问题:** `COUNT 1` + `BLOCK 5000` + `setInterval(poll, 5000)`。`BLOCK 5000` 在无消息时阻塞 5s;有消息时立即返回,但下一次 poll 仍要等 5s 定时器。突发 N 条 dispatch 需 ~5N 秒排空。

**建议修法:** 处理完消息后立即重新 poll(while 循环直到无消息),或增大 COUNT。

---

### 8. `TaskDispatchService.dispatchTask` 在生产代码中无调用入口

【TaskDispatchService.ts:174;server.ts 全文无调用(已 grep 确认)】

**问题:** 跨团队 `dispatchTask` 仅被测试调用。server.ts 中 `svc.dispatchTask`(5194/5216 行)是 `TeamProvisioningService.dispatchTask`(基于 assignee 的通知,不同方法)。MCP 工具列表(claim_task / complete_task / accept_task / reject_task / deliver_task / approve_task / reject_result)无 `dispatch_task`;`list_teams` 工具描述明确"agent 不应自行派发"。

**影响:** 整个跨团队任务派发生命周期目前休眠。上述远程相关缺陷(#1 的远程部分 / #3 / #4 / #6)在 dispatch 入口接通前不会在生产中触发。#1 的 local 部分与 #2/#5/#7 在当前休眠状态下也不触发。

**建议修法:** 确认是否有意未接通;若计划接通,优先修 #1/#3/#4/#6 再开通入口。

---

### 9. 重复投递时旧 msgId 在 PEL 中泄漏

【TaskDispatchService.ts:1155-1175 (`handleIncomingDispatch`)】

**问题:** 同一 `dispatchId` 重复到达(Redis 重投递)时,`pendingRequests.set` 覆盖为新 `msgId`,旧 `msgId` 永不 ACK,滞留 PEL。`alreadyPending` 被计算后显式 `void alreadyPending` 忽略。

**建议修法:** 覆盖前 ACK 旧 msgId;或检测到 `alreadyPending` 时直接 ACK 新消息(幂等)。

---

### 10. feishu/lark 去重非对称(lark 恒胜)—— 有意为之,可接受

【server.ts:811-819 (`normalizePlatformAllowUpdate`)】

**问题:** 同一 update 同时含 `feishu` 和 `lark` 时,`if (normalized.lark !== undefined) delete normalized.feishu` 删除 feishu 保留 lark。读取侧 `getPlatformAllowValue`(externalPlatformSessionRouting.ts:34-40)对 feishu/lark 互相 fallback,所以功能上不影响。注意:此处删除只影响**同一 update 内**的重复,不会误删 manifest 中已有的其他平台键(但 `updateTeam` 用 `{...manifest, ...patch}` 整体替换 `platformAllowFrom`,所以 manifest 原有的非 feishu/lark 键也会被新 patch 整体覆盖——这是 patch 语义,非去重 bug)。

**结论:** 别名合并逻辑正确,非数据丢失 bug。若产品上需要 feishu/lark 配不同用户则需调整,但当前设计合理。

---

## 已验证无问题的点(Correct)

- **`onCollabChange` / `onRuntimeStart` 无监听器泄漏:** server.ts:689-694 仅赋值一次,是属性赋值(非 `addEventListener`),覆盖即替换。`subscribeStatus` 中 `redisSub.on('message', …)` 绑定在每次 `connectRedis` 新建的 `redisSub` 上,旧实例 disconnect 后自动失效。无重复绑定。
- **`startingTasks` 锁:** 正确防止并发 start(`startDispatchedTask` 第 318-326 行 lockKey 去重);`task.status !== 'todo'` 检查(第 353 行)防止已完成任务重复启动。
- **`feishu:{chat}:{user}` session key 解析正确:** `parseExternalPlatformSessionKey` 对 feishu/lark 只认 union id(`on_`/`union`),open id(`ou_`)通过 `routingUserIdFromSessionKey` fallback 补救;大小写不敏感;空值/缺 chat 均有兜底。
- **teamName 被当成 `feishu:` key 的风险已兜底:** `resolveTeamFromBridgeMessage`(server.ts:1144-1171)对外部平台 key 走 `resolveTeamSlugFromCcSessions`,不落到 `resolveTeamSlugFromTeamName(sessionKey)` 兜底;`/api/teams`(server.ts:2042/2051)用 `startsWith('feishu:')` 过滤残留目录。
- **重复 dispatch 幂等:** `collabBoard.addTask` 已存在则返回原条目;`createOrReuseReceivedTask` 按 dispatchId 去重。功能正确(但 PEL 有 msgId 泄漏,见 #9)。
- **`normalizePlatformAllowFrom` 本身不删数据:** 纯过滤空值,无副作用。

---

## 残余风险 (Residual Risks)

1. **远程跨团队路径零测试覆盖:** 所有 TaskDispatchService 测试均为 local 同进程双团队。#1(远程部分)/#3/#4/#6 在测试中无法暴露,需集成测试或契约测试补充。
2. **dispatchTask 无生产入口:** 若未来接通入口,#1-#6 会立即暴露为生产缺陷。
3. **collabBoard 跨机不同步:** `syncFromRedis` 仅启动时调用一次,运行期无活同步;远程多机 collab board 状态会持续漂移。

---

## 总体结论

任务生命周期的**本地单机路径**设计合理、状态机迁移有守卫、测试覆盖到位;但**自动审批(#1)是确凿的双重死代码 bug**,`sendFeishuNotification` 的**硬编码 chat_id(#2)**是明确的开发遗留。远程跨团队路径存在多处静默丢弃响应/状态不同步缺陷(#3/#4/#6),且 `dispatchTask` 目前无生产入口(#8)使这些缺陷暂为潜伏态。deadline 超时处理(#5)有状态不一致问题。建议优先修 #1 和 #2,再在接通远程 dispatch 入口前补齐 #3/#4/#5/#6。