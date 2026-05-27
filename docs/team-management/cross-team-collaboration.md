# Cross-Team Collaboration Workflow

## 目标

跨团队协作不是消息通知系统，而是一个轻量 workflow engine。

核心原则：

> 跨团队任务只有一个事实源：`CollabTask` 状态机 + `TaskEventLog`。

Redis、Inbox、飞书、看板都只是事实源的投影或通知通道，不能各自维护独立状态。

## 总体架构

```text
Command API
  ↓
CollabTaskStore       当前状态、版本号、SLA
  ↓
TaskEventLog          append-only 事件日志
  ↓
Outbox                待投递通知，可重试
  ↓
Redis / Inbox / Feishu / UI Projection
```

## 核心组件

### 1. CollabTaskStore

保存协作任务当前状态。

```typescript
interface CollabTask {
  dispatchId: string;
  subject: string;
  description?: string;
  fromTeam: string;
  toTeam: string;
  status: CollabTaskStatus;
  version: number;
  revisionCount: number;
  sla: CollabTaskSla;
  currentAttemptId?: string;
  createdAt: string;
  updatedAt: string;
}

type CollabTaskStatus =
  | 'pending_accept'
  | 'accepted'
  | 'in_progress'
  | 'delivered'
  | 'revision_requested'
  | 'approved'
  | 'rejected'
  | 'timeout_cancelled'
  | 'review_timeout'
  | 'escalated'
  | 'failed'
  | 'cancelled';

interface CollabTaskSla {
  acceptBy: string;
  reviewBy?: string;
  maxRevisionCount: number;
}
```

### 2. TaskEventLog

所有状态变化都写事件。事件不可变，可用于审计、恢复、重放看板。

```typescript
interface CollabTaskEvent {
  eventId: string;
  dispatchId: string;
  version: number;
  type:
    | 'task_sent'
    | 'task_accepted'
    | 'task_rejected'
    | 'task_delivered'
    | 'revision_requested'
    | 'task_approved'
    | 'task_timeout_cancelled'
    | 'review_timeout'
    | 'task_escalated'
    | 'task_failed'
    | 'notification_enqueued'
    | 'notification_delivered'
    | 'notification_failed';
  actor: ActorRef;
  payload?: Record<string, unknown>;
  createdAt: string;
}
```

### 3. InboxLedger

Inbox 是拉取式，不是中断式。

不要在任意状态变化时把消息强行塞进 agent 当前上下文。只写入 InboxLedger，agent 在合适时机主动调用：

```text
check_inbox()
ack_inbox()
```

适合读取 inbox 的时机：

- 当前任务完成
- agent 处于等待依赖状态
- heartbeat/checkpoint
- 用户要求查看进展

### 4. Outbox

所有通知先进入 Outbox，再异步投递。

```typescript
interface OutboxItem {
  id: string;
  dispatchId: string;
  channel: 'redis' | 'inbox' | 'feishu';
  target: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  nextRetryAt?: string;
  createdAt: string;
}
```

Redis、Inbox、飞书通知失败不能回滚任务状态，只能在 Outbox 里重试。

### 5. ArtifactRef

跨团队总线只传控制面数据，不传大内容。

`result` 只允许放摘要。大文件、日志、截图、patch 都用引用：

```typescript
interface Delivery {
  summary: string; // 建议 <= 1KB
  artifactRefs: ArtifactRef[];
}

interface ArtifactRef {
  id: string;
  kind: 'file' | 'directory' | 'url' | 'patch' | 'screenshot';
  uri: string; // file://..., hermit-artifact://..., https://...
  sizeBytes?: number;
  sha256?: string;
  description?: string;
}
```

## 状态机

```text
pending_accept
  ├─ accept  → accepted → in_progress → delivered → approved
  ├─ reject  → rejected
  └─ timeout → timeout_cancelled

delivered
  ├─ approve          → approved
  ├─ request_revision → revision_requested → in_progress
  └─ timeout          → review_timeout → escalated

any
  ├─ cancel → cancelled
  └─ fail   → failed
```

不要用 `revision` 表示执行中。`revision_requested` 表示“被退回”这个事实，然后重新进入 `in_progress`。

## Command API

所有操作都走 command。UI、Agent、系统定时器不能直接改状态。

```typescript
type CollabCommand =
  | { type: 'send'; taskId: string; fromTeam: string; toTeam: string; payload: SendPayload }
  | { type: 'accept'; taskId: string; actor: ActorRef; expectedStatus: 'pending_accept'; expectedVersion: number }
  | { type: 'reject'; taskId: string; actor: ActorRef; reason: string; expectedStatus: 'pending_accept'; expectedVersion: number }
  | { type: 'deliver'; taskId: string; actor: ActorRef; delivery: Delivery; expectedStatus: 'in_progress'; expectedVersion: number }
  | { type: 'approve'; taskId: string; actor: ActorRef; expectedStatus: 'delivered'; expectedVersion: number }
  | { type: 'request_revision'; taskId: string; actor: ActorRef; feedback: string; expectedStatus: 'delivered'; expectedVersion: number }
  | { type: 'timeout'; taskId: string; actor: 'system'; expectedStatus: 'pending_accept' | 'delivered'; expectedVersion: number }
  | { type: 'cancel'; taskId: string; actor: ActorRef; reason: string; expectedVersion: number };
```

后端处理 command 的统一步骤：

1. 读取当前 `CollabTask`
2. 校验 `expectedStatus`
3. 校验 `expectedVersion`
4. 原子更新状态和 `version`
5. 写 `TaskEventLog`
6. 写 `Outbox`
7. 返回新状态

## 并发与幂等

状态更新必须带前置条件。

SQL 形态：

```sql
UPDATE collab_tasks
SET status = ?, version = version + 1, updated_at = now()
WHERE dispatch_id = ?
  AND status = ?
  AND version = ?;
```

Redis 形态：

- 用 Lua script
- 或 WATCH/MULTI
- 或 stream event + single writer

如果更新失败，返回：

```text
任务状态已变化，请刷新
```

并且不能触发 Outbox。

## TTL / 超时熔断

必须有 `CollabTaskSweeper`。

建议每 30s 或 60s 扫描：

```text
pending_accept 且 now > acceptBy
  → timeout_cancelled

delivered 且 now > reviewBy
  → review_timeout

revisionCount > maxRevisionCount
  → escalated
```

Sweeper 不能直接改状态，也要提交 command：

```typescript
{ type: 'timeout', actor: 'system', expectedStatus, expectedVersion }
```

## Revision 上下文

每次退回都创建新的 attempt。

```typescript
interface Attempt {
  attemptId: string;
  dispatchId: string;
  executorTeam: string;
  startedAt: string;
  deliveredAt?: string;
  delivery?: Delivery;
  feedback?: string;
  previousAttemptId?: string;
}
```

进入 `revision_requested` 后，下一次给接收方 agent 的上下文必须包含：

```typescript
interface RevisionContext {
  originalTask: {
    subject: string;
    description?: string;
  };
  previousDelivery: Delivery;
  feedback: string;
  acceptanceCriteria?: string[];
  revisionCount: number;
}
```

不能只发一句“退回：xxx”。

## Deferred Promise 的定位

Deferred Promise 只能作为在线 agent 的加速器，不能作为事实源。

正确顺序：

```typescript
await taskStore.transition(...);
await eventLog.append(...);
await inbox.add(...);

pendingAgents.get(dispatchId)?.resolve(result);
pendingAgents.delete(dispatchId);
```

如果 agent 还在线，就立即唤醒；如果不在线，状态和 inbox 已经落库，下次 `check_inbox()` 仍然能恢复。

## UI 投影

协作看板不是独立状态源，只是 `CollabTask + TaskEventLog` 的投影。

### 派发方视角

- 目标团队
- 当前状态
- 是否已接单
- 是否待审核
- 交付摘要
- 审核按钮

### 接收方视角

- 来源团队
- 待接单任务
- 执行中任务
- 待重新提交任务
- 交付按钮

## API 草案

```text
POST /api/cross-team/tasks
POST /api/cross-team/tasks/:id/accept
POST /api/cross-team/tasks/:id/reject
POST /api/cross-team/tasks/:id/deliver
POST /api/cross-team/tasks/:id/approve
POST /api/cross-team/tasks/:id/request-revision
POST /api/cross-team/tasks/:id/cancel
GET  /api/cross-team/tasks
GET  /api/cross-team/tasks/:id/events
GET  /api/cross-team/inbox
POST /api/cross-team/inbox/ack
```

## 实施顺序

1. 定义 `CollabTask`、`TaskEventLog`、`OutboxItem`、`ArtifactRef` 类型。
2. 实现 `CollabTaskStore`，支持 CAS/version 更新。
3. 实现 `TaskEventLog` append-only 存储。
4. 实现 `Outbox` 和异步投递 worker。
5. 实现 `InboxLedger`，只允许 pull/ack。
6. 实现 command API。
7. 加 TTL sweeper。
8. 改造 Redis/飞书/inbox 为投影和通知。
9. 用 CollabTask 投影出派发方/接收方协作看板。

## 设计底线

1. 状态只由 command 触发，不能直接写。
2. 状态变化必须写 event log。
3. 通知通过 outbox 异步投递，可重试。
4. Agent 只 pull inbox，不被异步消息打断。
5. 大内容只走 artifact ref，不进 Redis/inbox/context。
# 跨团队协作设计

## 概述

跨团队协作允许不同 Hermit 团队之间派发和接收任务。需要配置 Redis 任务总线 + 开启"分布式团队协作"才能使用。

## 前置条件

1. **Redis 任务总线** — 在 设置 → 团队总线 中配置 Redis 连接
2. **分布式团队协作开关** — 在团队总线最下方开启"分布式团队协作 (beta)"
3. 两个团队都连接到同一个 Redis 实例

## 任务状态流转

```
                    ┌──────────────────────────────────────────┐
                    │                                          │
派发方                │  接收方                                   │
                    │                                          │
POST /api/cross-team/send ──→ pending_accept (待接受)           │
                    │       │                                  │
                    │       ├── 接单 ──→ accepted (进行中)      │
                    │       │              │                   │
                    │       │              ├── 交付 ──→ delivered (待审核)
                    │       │              │              │    │
                    │       │              │              ├── 通过 → approved (已完成) ✓
                    │       │              │              │         │
                    │       │              │              └── 退回 → revision (修改中)
                    │       │              │                         │
                    │       │              │                         └── 重新交付 → delivered
                    │       │              │                                  │
                    │       │              │                                  └── (循环)
                    │       │              │
                    │       └── 拒绝 ──→ rejected (已拒绝) ──→ 通知派发方 agent
                    │                                          │
                    └──────────────────────────────────────────┘
```

## API 交互

### 1. 发现团队

```
GET /api/cross-team/targets?excludeTeam=prd
```

返回所有可用团队列表（本地 + Redis 远程），排除自身。

### 2. 派发任务

```
POST /api/cross-team/send
{
  "fromTeam": "prd",
  "toTeam": "hermit",
  "subject": "修改 API 接口",
  "description": "需要修改 /api/users 的返回格式",
  "deadlineMinutes": 120,
  "needsHumanReview": true
}
```

返回：
```json
{
  "ok": true,
  "dispatchId": "uuid",
  "status": "pending_accept",
  "message": "Task dispatched to hermit, awaiting acceptance."
}
```

**派发后自动执行：**
1. 派发方的看板创建 shadow task `[→hermit] 修改 API 接口`
2. 协作看板创建 pending_accept 任务
3. 写入目标团队 inbox 消息
4. 飞书通知

### 3. 接受任务（接收方）

```
POST /api/cross-team/accept
{
  "team_slug": "hermit",
  "dispatch_id": "uuid"
}
```

- 目标团队看板创建实际任务
- 协作看板状态变为 `accepted`
- 通知派发方任务已接受

### 4. 拒绝任务（接收方）

```
POST /api/cross-team/reject
{
  "team_slug": "hermit",
  "dispatch_id": "uuid",
  "reason": "当前团队没有该仓库的访问权限"
}
```

- 协作看板状态变为 `rejected`
- 通知派发方 agent 任务被拒绝

### 5. 交付结果（接收方完成工作后）

```
POST /api/cross-team/deliver
{
  "team_slug": "hermit",
  "dispatch_id": "uuid",
  "result": "已完成，修改了 3 个文件的 API 返回格式"
}
```

### 6. 审核通过（派发方确认）

```
POST /api/cross-team/approve
{
  "team_slug": "hermit",
  "dispatch_id": "uuid"
}
```

### 7. 退回修改（派发方不满意）

```
POST /api/cross-team/revision
{
  "team_slug": "hermit",
  "dispatch_id": "uuid",
  "feedback": "返回格式还是不对，需要包含分页信息"
}
```

## UI 交互

### 协作看板（CollabBoardPanel）

5 列看板视图：
- **待接受** — 黄色背景，incoming 任务显示"接单"/"拒绝"按钮
- **进行中** — 蓝色背景，incoming 任务显示"交付结果"按钮
- **待审核** — 紫色背景，origin 任务显示"通过"/"退回"按钮
- **修改中** — 橙色背景，incoming 任务显示"重新交付"按钮
- **已完成** — 绿色背景

10 秒自动刷新。

### 任务池（外部派单）

TeamDetailView 中的"外部派单"section 显示团队内部 kanban，包含 shadow task。

## 分布式团队协作开关

在 设置 → 团队总线 最下方：
- **开启** — 注入跨团队协作指令到 CLAUDE.md，agent 可以 dispatch 任务
- **关闭** — 不注入指令，agent 不会主动跨团队

## 消息投递机制

| 场景 | 投递方式 |
|------|----------|
| 同实例本地团队 | 写入目标团队 inbox (appendMessage) + 飞书通知 |
| 跨实例 Redis | Redis Streams (task:dispatch:{teamSlug}) + 飞书通知 |
